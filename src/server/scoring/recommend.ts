import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { capabilityProbe, metricSnapshot, models, recommendation } from "../../db/schema.js";
import type { MetricSnapshot, Modality, RecommendationCategory } from "../../db/schema.js";
import { gatewayChat } from "../iu/client.js";
import { normalizeMetrics } from "./normalize.js";
import { CATEGORY_WEIGHTS, scoreModels } from "./score.js";

const CATEGORY_MODALITY: Record<RecommendationCategory, Modality> = {
  fast: "llm",
  coding: "llm",
  orchestrator: "llm",
  tts: "tts",
  stt: "stt",
};

// Native Anthropic route — fast, cheap, and reliably available on the gateway.
const RATIONALE_MODEL = "claude-haiku-4-5";
const RATIONALE_PROVIDER = "anthropic";

async function generateRationale(
  category: RecommendationCategory,
  modelId: string,
  score: number,
  quality: number | null,
  cost: number | null,
  speed: number | null,
): Promise<string | null> {
  const weights = CATEGORY_WEIGHTS[category];
  const components: string[] = [];
  if (quality !== null) components.push(`quality ${(quality * 100).toFixed(0)}%`);
  if (cost !== null) components.push(`cost-efficiency ${(cost * 100).toFixed(0)}%`);
  if (speed !== null) components.push(`speed ${(speed * 100).toFixed(0)}%`);

  const componentStr = components.length > 0 ? components.join(", ") : "no scored components";
  const prompt =
    `Explain in 1-2 sentences why "${modelId}" is the best model for the "${category}" use case. ` +
    `Its total score is ${score.toFixed(3)} (scale 0-1). ` +
    `Normalized score components (0=worst, 100=best): ${componentStr}. ` +
    `Category weights: quality ${(weights.quality * 100).toFixed(0)}%, ` +
    `cost ${(weights.cost * 100).toFixed(0)}%, speed ${(weights.speed * 100).toFixed(0)}%. ` +
    `Focus on the dominant score drivers. Write plain text, no markdown or bullets.`;

  try {
    const resp = await gatewayChat({
      model: RATIONALE_MODEL,
      provider: RATIONALE_PROVIDER,
      prompt,
      maxTokens: 120,
      temperature: 0.2,
    });
    if (resp.status === "timeout" || resp.status < 200 || resp.status >= 300) return null;
    return resp.text;
  } catch {
    return null;
  }
}

export async function runRecommender(snapshotDate?: string): Promise<void> {
  const date = snapshotDate ?? new Date().toISOString().slice(0, 10);

  // Deduplicate to latest snapshot per (model, source, metric) — avoids stale duplicates
  const allSnapshots = await db
    .select()
    .from(metricSnapshot)
    .orderBy(desc(metricSnapshot.captured_at));

  const seen = new Set<string>();
  const latestSnapshots: MetricSnapshot[] = [];
  for (const snap of allSnapshots) {
    const key = `${snap.model_id}|${snap.source}|${snap.metric}`;
    if (!seen.has(key)) {
      seen.add(key);
      latestSnapshots.push(snap);
    }
  }

  // Latest accessibility + latency per model
  const allProbes = await db
    .select({
      model_id: capabilityProbe.model_id,
      accessible: capabilityProbe.accessible,
      latency_ms: capabilityProbe.latency_ms,
      checked_at: capabilityProbe.checked_at,
    })
    .from(capabilityProbe)
    .orderBy(desc(capabilityProbe.checked_at));

  const latestProbeByModel = new Map<string, { accessible: boolean; latency_ms: number | null }>();
  for (const probe of allProbes) {
    if (!latestProbeByModel.has(probe.model_id)) {
      latestProbeByModel.set(probe.model_id, {
        accessible: probe.accessible,
        latency_ms: probe.latency_ms,
      });
    }
  }

  // Modality per model
  const allModels = await db.select({ id: models.id, modality: models.modality }).from(models);
  const modalityByModel = new Map<string, Modality>();
  for (const m of allModels) {
    modalityByModel.set(m.id, m.modality);
  }

  const normalizedMetrics = normalizeMetrics(latestSnapshots);

  const persist = (
    category: RecommendationCategory,
    modelId: string,
    score: number,
    rationale: string | null,
  ): Promise<unknown> =>
    db
      .insert(recommendation)
      .values({ category, model_id: modelId, score, rationale, snapshot_date: date })
      .onConflictDoUpdate({
        target: [recommendation.category, recommendation.snapshot_date],
        set: { model_id: modelId, score, rationale },
      });

  const categories: RecommendationCategory[] = ["fast", "coding", "orchestrator", "tts", "stt"];
  for (const category of categories) {
    const targetModality = CATEGORY_MODALITY[category];

    // Audio (tts/stt): leaderboards publish no quality/cost metrics for these, so
    // rank accessible models by measured access latency (faster = better).
    if (targetModality === "tts" || targetModality === "stt") {
      const top = pickFastestAccessible(targetModality, modalityByModel, latestProbeByModel);
      if (!top) {
        console.warn(`[recommend] no accessible ${category} models — skipping`);
        continue;
      }
      const rationale =
        `Fastest accessible ${category.toUpperCase()} model on the IU endpoint ` +
        `(probe latency ${Math.round(top.latency_ms)}ms). Leaderboards don't publish ` +
        `audio quality/cost metrics, so ranking uses measured access latency.`;
      await persist(category, top.model_id, top.score, rationale);
      console.log(
        `[recommend] ${category}: ${top.model_id} (latency ${Math.round(top.latency_ms)}ms)`,
      );
      continue;
    }

    const weights = CATEGORY_WEIGHTS[category];
    const eligibleMetrics = normalizedMetrics.filter((m) => {
      if (modalityByModel.get(m.model_id) !== targetModality) return false;
      return latestProbeByModel.get(m.model_id)?.accessible === true;
    });

    if (eligibleMetrics.length === 0) {
      console.warn(`[recommend] no eligible models for "${category}" — skipping`);
      continue;
    }

    const scored = scoreModels(eligibleMetrics, weights);
    const top = scored[0];
    if (!top) continue;

    const rationale = await generateRationale(
      category,
      top.model_id,
      top.score,
      top.quality,
      top.cost,
      top.speed,
    );

    await persist(category, top.model_id, top.score, rationale);
    console.log(`[recommend] ${category}: ${top.model_id} (score: ${top.score.toFixed(3)})`);
  }

  console.log(`[recommend] done for ${date}`);
}

/** Picks the lowest-latency accessible model of a modality. Returns the model id,
 *  its latency, and a 0-1 score (1 = fastest in the set). Null if none qualify. */
function pickFastestAccessible(
  modality: Modality,
  modalityByModel: Map<string, Modality>,
  probes: Map<string, { accessible: boolean; latency_ms: number | null }>,
): { model_id: string; latency_ms: number; score: number } | null {
  const candidates: { model_id: string; latency_ms: number }[] = [];
  for (const [model_id, probe] of probes) {
    if (!probe.accessible || probe.latency_ms === null) continue;
    if (modalityByModel.get(model_id) !== modality) continue;
    candidates.push({ model_id, latency_ms: probe.latency_ms });
  }
  if (candidates.length === 0) return null;

  const latencies = candidates.map((c) => c.latency_ms);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const fastest = candidates.reduce((a, b) => (b.latency_ms < a.latency_ms ? b : a));
  const score = max === min ? 1 : 1 - (fastest.latency_ms - min) / (max - min);
  return { model_id: fastest.model_id, latency_ms: fastest.latency_ms, score };
}
