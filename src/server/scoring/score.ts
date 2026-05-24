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

// Default weights per category. Quality dominates orchestrator/coding;
// speed+cost matter more for fast. TTS/STT mirrors a balanced profile.
export const CATEGORY_WEIGHTS: Record<RecommendationCategory, CategoryWeights> = {
  fast: { quality: 0.3, cost: 0.3, speed: 0.4 },
  coding: { quality: 0.6, cost: 0.2, speed: 0.2 },
  orchestrator: { quality: 0.7, cost: 0.15, speed: 0.15 },
  tts: { quality: 0.5, cost: 0.3, speed: 0.2 },
  stt: { quality: 0.5, cost: 0.3, speed: 0.2 },
};

// Score a list of models with the given weights and return them sorted
// highest-score first. Null metric dimensions contribute 0.
export function scoreModels(
  metrics: ModelMetrics[],
  weights: CategoryWeights,
): ModelScore[] {
  return metrics
    .map(({ model_id, quality, cost, speed }) => {
      const score =
        weights.quality * (quality ?? 0) +
        weights.cost * (cost ?? 0) +
        weights.speed * (speed ?? 0);
      return { model_id, score, quality, cost, speed };
    })
    .toSorted((a, b) => b.score - a.score);
}
