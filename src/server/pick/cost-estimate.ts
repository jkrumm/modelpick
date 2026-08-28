// Prints a one-line, deliberately conservative cost estimate for probing a set
// of models before any money gets spent. The context-window binary search
// dominates: worst case is a full descent from the 1.1M ceiling, which sums to
// roughly 2x the ceiling in input tokens (a telescoping series) — most models
// land far cheaper because the gateway names an exact limit on the first call.
import { SEED_PRICES } from "./seed-prices.js";

const DEFAULT_PRICE_IN_PER_M = 2.0; // conservative guess for an unseeded model
const DEFAULT_PRICE_OUT_PER_M = 6.0;

const COST_SOLVE_TOKENS = { in: 700, out: 940 };
const CACHE_PROBE_TOKENS = { in: 6_050, out: 16 };
const MAX_TOKENS_PROBE_TOKENS = { in: 20, out: 64 };
// Worst case: ceiling shot + full binary-search descent.
const CONTEXT_PROBE_TOKENS = { in: 2_200_000, out: 8 };

const TOTAL_IN =
  COST_SOLVE_TOKENS.in +
  CACHE_PROBE_TOKENS.in +
  MAX_TOKENS_PROBE_TOKENS.in +
  CONTEXT_PROBE_TOKENS.in;
const TOTAL_OUT =
  COST_SOLVE_TOKENS.out +
  CACHE_PROBE_TOKENS.out +
  MAX_TOKENS_PROBE_TOKENS.out +
  CONTEXT_PROBE_TOKENS.out;

function estimateModelCostUsd(modelId: string): number {
  const seed = SEED_PRICES[modelId];
  const priceIn = seed?.priceInPerM ?? DEFAULT_PRICE_IN_PER_M;
  const priceOut = seed?.priceOutPerM ?? DEFAULT_PRICE_OUT_PER_M;
  return (TOTAL_IN / 1e6) * priceIn + (TOTAL_OUT / 1e6) * priceOut;
}

export function estimateProbeRunCostUsd(modelIds: string[]): number {
  return modelIds.reduce((sum, id) => sum + estimateModelCostUsd(id), 0);
}

export function formatCostEstimateLine(modelIds: string[]): string {
  if (modelIds.length === 0) return "No models need probing — everything is cached.";
  const usd = estimateProbeRunCostUsd(modelIds);
  return (
    `Probing ${modelIds.length} model(s) — worst-case estimate ~$${usd.toFixed(2)} ` +
    `(context-window binary search dominates; most models name an exact limit on the first ` +
    `call and cost far less).`
  );
}
