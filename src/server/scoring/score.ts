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
//  - fast: the estate default for summaries/titles/transforms and Hermes' brain.
//    Capability-led, with cost and speed still counting: the owner decision
//    (2026-10-26, STACK "Estate default / fast", docs/decisions/hermes-brain.md) is
//    that capability beats cost, and the old cost-led 0.25/0.40/0.35 split picked
//    mimo-v2.6-flash (AA 37.9, 51 tok/s, 3.0s) over deepseek-v4.1-flash (AA 45.1,
//    167 tok/s, 1.2s) purely on $0.28 vs $1.12 per 1M output. Quality is now the
//    largest term; cost keeps a quarter so a 10x price gap still moves the ranking,
//    and speed stays near its old weight. Uses general intelligence.
//  - coding: a cheap *value* coder (Sonnet-like), not the priciest flagship
//    → coding index balanced against cost.
//  - orchestrator: max capability (Opus-like), cost almost irrelevant
//    → quality dominates.
export const CATEGORY_WEIGHTS: Record<RecommendationCategory, CategoryWeights> = {
  fast: { quality: 0.45, cost: 0.25, speed: 0.3 },
  coding: { quality: 0.5, cost: 0.35, speed: 0.15 },
  // writing: a long-form/creative pick — prose quality dominates, this is not
  // a cheap-utility category.
  writing: { quality: 0.75, cost: 0.15, speed: 0.1 },
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
  // The writing dimension is itself the floor — an unmeasured model scores 0
  // on it (via scoreModels' `q ?? 0`), so no separate general-quality gate is
  // needed here.
  writing: 0,
  orchestrator: 0,
  tts: 0,
  stt: 0,
};

// Score a list of models with the given weights and return them sorted
// highest-score first. Null metric dimensions contribute 0. `qualityDim` selects
// which quality signal to weight — "coding" for the coding category, "writing"
// for the writing category, else the general intelligence index.
export function scoreModels(
  metrics: ModelMetrics[],
  weights: CategoryWeights,
  qualityDim: "quality" | "coding" | "writing" = "quality",
): ModelScore[] {
  return metrics
    .map(({ model_id, quality, coding, cost, speed, writing }) => {
      const q = qualityDim === "coding" ? coding : qualityDim === "writing" ? writing : quality;
      const score =
        weights.quality * (q ?? 0) + weights.cost * (cost ?? 0) + weights.speed * (speed ?? 0);
      return { model_id, score, quality: q, cost, speed };
    })
    .toSorted((a, b) => b.score - a.score);
}
