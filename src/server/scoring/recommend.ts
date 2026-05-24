import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { capabilityProbe, metricSnapshot, models, recommendation } from "../../db/schema.js";
import type { MetricSnapshot, Modality, RecommendationCategory } from "../../db/schema.js";
import { iuFetch } from "../iu/client.js";
import { normalizeMetrics } from "./normalize.js";
import { CATEGORY_WEIGHTS, scoreModels } from "./score.js";

const CATEGORY_MODALITY: Record<RecommendationCategory, Modality> = {
  fast: "llm",
  coding: "llm",
  orchestrator: "llm",
  tts: "tts",
  stt: "stt",
};

const RATIONALE_MODEL = "claude-haiku-4-5-eu";

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

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
    const resp = await iuFetch<ChatCompletionResponse>("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: RATIONALE_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.2,
      }),
    });

    if (resp.status < 200 || resp.status >= 300) return null;
    return resp.body.choices[0]?.message.content ?? null;
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

  // Latest accessibility per model
  const allProbes = await db
    .select({
      model_id: capabilityProbe.model_id,
      accessible: capabilityProbe.accessible,
      checked_at: capabilityProbe.checked_at,
    })
    .from(capabilityProbe)
    .orderBy(desc(capabilityProbe.checked_at));

  const latestProbeByModel = new Map<string, boolean>();
  for (const probe of allProbes) {
    if (!latestProbeByModel.has(probe.model_id)) {
      latestProbeByModel.set(probe.model_id, probe.accessible);
    }
  }

  // Modality per model
  const allModels = await db.select({ id: models.id, modality: models.modality }).from(models);
  const modalityByModel = new Map<string, Modality>();
  for (const m of allModels) {
    modalityByModel.set(m.id, m.modality);
  }

  const normalizedMetrics = normalizeMetrics(latestSnapshots);

  const categories: RecommendationCategory[] = ["fast", "coding", "orchestrator", "tts", "stt"];
  for (const category of categories) {
    const targetModality = CATEGORY_MODALITY[category];
    const weights = CATEGORY_WEIGHTS[category];

    const eligibleMetrics = normalizedMetrics.filter((m) => {
      if (modalityByModel.get(m.model_id) !== targetModality) return false;
      return latestProbeByModel.get(m.model_id) === true;
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

    await db
      .insert(recommendation)
      .values({
        category,
        model_id: top.model_id,
        score: top.score,
        rationale,
        snapshot_date: date,
      })
      .onConflictDoUpdate({
        target: [recommendation.category, recommendation.snapshot_date],
        set: {
          model_id: top.model_id,
          score: top.score,
          rationale,
        },
      });

    console.log(`[recommend] ${category}: ${top.model_id} (score: ${top.score.toFixed(3)})`);
  }

  console.log(`[recommend] done for ${date}`);
}
