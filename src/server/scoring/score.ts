import type { RecommendationCategory } from "../../db/schema.js";
import type { ModelMetrics } from "./normalize.js";

export interface CategoryWeights {
  quality: number;
  cost: number;
  speed: number;
}

export interface ModelScore {
  model_id: string;
  score: number;
  quality: number | null;
  cost: number | null;
  speed: number | null;
}

// Default weights per category, modelled on the Haiku / Sonnet / Opus tiers:
//  - fast: a cheap, responsive, good-enough model for summaries/titles/transforms
//    → cost-led with a quality floor (uses general intelligence).
//  - coding: a cheap *value* coder (Sonnet-like), not the priciest flagship
//    → coding index balanced against cost.
//  - orchestrator: max capability (Opus-like), cost almost irrelevant
//    → quality dominates.
export const CATEGORY_WEIGHTS: Record<RecommendationCategory, CategoryWeights> = {
  fast: { quality: 0.25, cost: 0.4, speed: 0.35 },
  coding: { quality: 0.5, cost: 0.35, speed: 0.15 },
  orchestrator: { quality: 0.88, cost: 0.04, speed: 0.08 },
  tts: { quality: 0.5, cost: 0.3, speed: 0.2 },
  stt: { quality: 0.5, cost: 0.3, speed: 0.2 },
};

// Minimum normalized general-intelligence a model needs to qualify for a category
// — a "good enough" floor so a cheap model can't win on price alone. 0 = no floor.
//  - fast ~0.5 (≈ AA intelligence 38): a usable utility model for summaries/titles.
//  - coding ~0.8 (≈ AA intelligence 51): real coding needs broad reasoning, not just
//    a high coding-benchmark — so require a broadly-smart model, not a mini/nano.
export const CATEGORY_MIN_QUALITY: Record<RecommendationCategory, number> = {
  fast: 0.5,
  coding: 0.8,
  orchestrator: 0,
  tts: 0,
  stt: 0,
};

// Score a list of models with the given weights and return them sorted
// highest-score first. Null metric dimensions contribute 0. `qualityDim` selects
// which quality signal to weight — "coding" for the coding category, else the
// general intelligence index.
export function scoreModels(
  metrics: ModelMetrics[],
  weights: CategoryWeights,
  qualityDim: "quality" | "coding" = "quality",
): ModelScore[] {
  return metrics
    .map(({ model_id, quality, coding, cost, speed }) => {
      const q = qualityDim === "coding" ? coding : quality;
      const score =
        weights.quality * (q ?? 0) + weights.cost * (cost ?? 0) + weights.speed * (speed ?? 0);
      return { model_id, score, quality: q, cost, speed };
    })
    .toSorted((a, b) => b.score - a.score);
}
