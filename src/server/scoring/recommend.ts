import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { capabilityProbe, metricSnapshot, models, recommendation } from "../../db/schema.js";
import type { MetricSnapshot, Modality, RecommendationCategory } from "../../db/schema.js";
import { gatewayChat } from "../iu/client.js";
import { curate, isDatedPin } from "../curate.js";
import { normalizeMetrics } from "./normalize.js";
import { CATEGORY_MIN_QUALITY, CATEGORY_WEIGHTS, scoreModels } from "./score.js";

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

  // Propagate leaderboard data across catalog variants and restrict picks to the
  // "current" representative set (drops dated pins and stale, untracked models).
  const { metrics: normalizedMetrics, currentIds } = curate(
    allModels.map((m) => ({ id: m.id, modality: m.modality })),
    normalizeMetrics(latestSnapshots),
    (id) => latestProbeByModel.get(id)?.accessible === true,
  );

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

    // Audio (tts/stt): no leaderboard publishes audio quality, and ranking by
    // latency wrongly surfaces the legacy models (they're the simplest/fastest).
    // Instead prefer the modern generation, breaking ties by access latency.
    if (targetModality === "tts" || targetModality === "stt") {
      const top = pickBestAudio(targetModality, modalityByModel, latestProbeByModel);
      if (!top) {
        console.warn(`[recommend] no accessible ${category} models — skipping`);
        continue;
      }
      const rationale =
        `Best accessible ${category.toUpperCase()} model on the IU endpoint: the current ` +
        `generation preferred over legacy variants (probe latency ${Math.round(top.latency_ms)}ms). ` +
        `No leaderboard publishes audio quality, so this uses a generation preference.`;
      await persist(category, top.model_id, top.score, rationale);
      console.log(
        `[recommend] ${category}: ${top.model_id} (latency ${Math.round(top.latency_ms)}ms)`,
      );
      continue;
    }

    const weights = CATEGORY_WEIGHTS[category];
    const minQuality = CATEGORY_MIN_QUALITY[category];
    const eligibleMetrics = normalizedMetrics.filter((m) => {
      if (modalityByModel.get(m.model_id) !== targetModality) return false;
      if (!currentIds.has(m.model_id)) return false;
      if ((m.quality ?? 0) < minQuality) return false;
      return latestProbeByModel.get(m.model_id)?.accessible === true;
    });

    if (eligibleMetrics.length === 0) {
      console.warn(`[recommend] no eligible models for "${category}" — skipping`);
      continue;
    }

    const scored = scoreModels(
      eligibleMetrics,
      weights,
      category === "coding" ? "coding" : "quality",
    );
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

/** Manual quality preference for audio models — no leaderboard exists, so this
 *  encodes a coarse "modern generation > legacy" ordering. Higher = better. */
function audioQualityRank(id: string, modality: Modality): number {
  const s = id.toLowerCase();
  if (modality === "tts") {
    if (s.includes("gemini-3") && s.includes("tts")) return 5; // Gemini 3.x Flash TTS — our default
    if (s.includes("gemini") && (s.includes("tts") || s.includes("audio"))) return 4; // Gemini 2.5 TTS
    if (s.includes("4o") && s.includes("tts")) return 3; // gpt-4o(-mini)-tts: steerable
    if (s.includes("hd")) return 2; // tts-hd: legacy high-quality
    return 1; // tts: legacy
  }
  // stt
  if (s.includes("4o") && s.includes("transcribe")) return s.includes("mini") ? 3 : 4; // gpt-4o(-mini)-transcribe
  if (s.includes("voxtral")) return 2; // Voxtral (EU-hosted)
  return 1; // whisper: legacy
}

/** Picks the best accessible audio model: highest quality rank, then undated
 *  alias, then lowest latency. Score is the rank normalized to 0-1. */
function pickBestAudio(
  modality: Modality,
  modalityByModel: Map<string, Modality>,
  probes: Map<string, { accessible: boolean; latency_ms: number | null }>,
): { model_id: string; latency_ms: number; score: number } | null {
  const candidates: { model_id: string; latency_ms: number; rank: number }[] = [];
  for (const [model_id, probe] of probes) {
    if (!probe.accessible || probe.latency_ms === null) continue;
    if (modalityByModel.get(model_id) !== modality) continue;
    candidates.push({
      model_id,
      latency_ms: probe.latency_ms,
      rank: audioQualityRank(model_id, modality),
    });
  }
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => {
    if (b.rank !== a.rank) return b.rank > a.rank ? b : a;
    const ad = isDatedPin(a.model_id);
    const bd = isDatedPin(b.model_id);
    if (ad !== bd) return ad ? b : a;
    return b.latency_ms < a.latency_ms ? b : a;
  });
  const maxRank = candidates.reduce((m, c) => Math.max(m, c.rank), 0);
  const score = maxRank > 0 ? best.rank / maxRank : 1;
  return { model_id: best.model_id, latency_ms: best.latency_ms, score };
}
