/**
 * What a ccbench run actually cost.
 *
 * The Claude Code CLI reports `total_cost_usd` / `modelUsage[*].costUSD` with
 * `costBasis: "list"`. For real Claude ids that number is correct — solved
 * against its own token counts on four live runs, it lands exactly on Anthropic
 * list pricing. For the **non-Claude** ids the same IU Anthropic route serves
 * (`DeepSeek-V4-Flash`, `glm-5.3-flash`, `kimi-k2.7-code`, …) it is nonsense:
 * the CLI has never heard of those ids, so it prices their tokens at a
 * Claude-tier default. Measured, that put `DeepSeek-V4-Flash` at ~5x
 * `claude-haiku-4-5` for the same two tasks, when its real rate ($0.44/$1.32
 * per MTok vs haiku's $1/$5) puts it comfortably *below*.
 *
 * So: price from token counts and a real rate card whenever one resolves, and
 * fall back to the CLI's number only when none does. The basis travels with the
 * number so no table can quietly mix the two.
 *
 * Pure — no DB, no fs, no clock. The caller loads `pick_probe` and passes the
 * rates in, which is also what makes every function here trivially testable and
 * lets the same code reprice stored rows.
 */
import type { CostBasis, RunMetrics } from "./types.js";

export type { CostBasis };

/** Per-MTok rates for one model. `null` cache rates fall back to the Anthropic
 *  ratios in `computeCost` rather than to zero — a missing cache rate must
 *  never make cached tokens look free. */
export interface Rates {
  inPerM: number;
  outPerM: number;
  cacheReadPerM: number | null;
  cacheWritePerM: number | null;
}

/** Cache-read costs 0.1x input, cache-write 1.25x input. Anthropic's published
 *  ratios, applied whenever a rate card names no explicit cache rate. */
const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;

/**
 * Anthropic **list** rates for the six ccbench Claude candidates, per MTok
 * input/output. Confirmed, not remembered: solving the CLI's own reported cost
 * against its own token counts on four live runs reproduces these exactly.
 *
 * Cache rates are deliberately left null so the 1.25x write / 0.1x read
 * defaults above apply in one place. Keyed by the *normalised* id — `-eu` twins
 * and dated aliases are stripped by `normaliseModelId` rather than listed here.
 */
export const CLAUDE_LIST_RATES: Record<string, Rates> = {
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5, cacheReadPerM: null, cacheWritePerM: null },
  "claude-sonnet-5": { inPerM: 2, outPerM: 10, cacheReadPerM: null, cacheWritePerM: null },
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15, cacheReadPerM: null, cacheWritePerM: null },
  "claude-opus-4-8": { inPerM: 5, outPerM: 25, cacheReadPerM: null, cacheWritePerM: null },
  "claude-opus-5": { inPerM: 5, outPerM: 25, cacheReadPerM: null, cacheWritePerM: null },
  "claude-fable-5": { inPerM: 10, outPerM: 50, cacheReadPerM: null, cacheWritePerM: null },
};

/** `claude-opus-4-8-eu` and `claude-haiku-4-5-20251001` are the same rate card
 *  as their parent. Strip the date first — an id can carry both suffixes. */
export function normaliseModelId(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "").replace(/-eu$/, "");
}

/** True when the id is one of the Claude candidates the CLI already prices
 *  correctly (including its `-eu` and dated aliases). */
export function isClaudeListId(modelId: string): boolean {
  return normaliseModelId(modelId) in CLAUDE_LIST_RATES;
}

/** The token counts a price needs — a full `RunMetrics` satisfies it, and so
 *  does a row read back out of `bench_run`. */
export type TokenCounts = Pick<
  RunMetrics,
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"
>;

export function computeCost(metrics: TokenCounts, rates: Rates): number {
  const cacheRead = rates.cacheReadPerM ?? rates.inPerM * CACHE_READ_RATIO;
  const cacheWrite = rates.cacheWritePerM ?? rates.inPerM * CACHE_WRITE_RATIO;
  return (
    (metrics.inputTokens * rates.inPerM +
      metrics.outputTokens * rates.outPerM +
      metrics.cacheReadTokens * cacheRead +
      metrics.cacheCreationTokens * cacheWrite) /
    1e6
  );
}

/**
 * Claude ids take the committed list card; everything else takes whatever
 * `pick_probe` solved from the gateway's own `usage.cost`. Null when neither
 * knows the id — the caller must then keep the CLI's number or render nothing,
 * never invent a zero.
 */
export function resolveRates(modelId: string, probeRates: Map<string, Rates>): Rates | null {
  const claude = CLAUDE_LIST_RATES[normaliseModelId(modelId)];
  if (claude) return claude;
  return probeRates.get(modelId) ?? null;
}

export interface PricedCost {
  costUsd: number | null;
  basis: CostBasis;
}

export interface PriceInput {
  modelId: string;
  tokens: TokenCounts;
  /** The CLI's own figure. Kept as the fallback so a row that was already
   *  priced never loses its number just because no rate card resolved. */
  reportedCostUsd: number | null;
}

/**
 * The one decision: measured rates if we have them, the CLI's list number if we
 * don't, and an explicit `unpriced` (cost `null`, never `0`) when we have
 * neither. A genuinely-free model reports `0` with a real basis; an unknown one
 * reports `null` — the report and the scoring treat those differently on
 * purpose.
 *
 * Note what a `list` basis means on a **non-Claude** id: the CLI's Claude-tier
 * default, i.e. the bug this module exists for, retained only because dropping
 * a previously-reported number would be worse than marking it.
 */
export function priceRun(input: PriceInput, probeRates: Map<string, Rates>): PricedCost {
  // A run that billed no tokens at all did not run — it died before the first
  // API call landed (the ~190s retry-storm failures do exactly this). Pricing
  // that as $0 hands the cheapest possible cost term to a model that produced
  // nothing, which is the one direction the composite must never reward.
  const billed =
    input.tokens.inputTokens +
    input.tokens.outputTokens +
    input.tokens.cacheReadTokens +
    input.tokens.cacheCreationTokens;
  if (billed === 0) return { costUsd: null, basis: "unpriced" };

  const rates = resolveRates(input.modelId, probeRates);
  if (rates) {
    return {
      costUsd: computeCost(input.tokens, rates),
      basis: isClaudeListId(input.modelId) ? "list" : "measured",
    };
  }
  if (input.reportedCostUsd !== null && Number.isFinite(input.reportedCostUsd)) {
    return { costUsd: input.reportedCostUsd, basis: "list" };
  }
  return { costUsd: null, basis: "unpriced" };
}

/** Re-prices one finished run in place of the CLI's number. Returns a new
 *  object — the runner keeps its results immutable. */
export function priceRunResult<T extends { modelId: string; metrics: RunMetrics }>(
  result: T,
  probeRates: Map<string, Rates>,
): T & { costBasis: CostBasis } {
  const priced = priceRun(
    {
      modelId: result.modelId,
      tokens: result.metrics,
      reportedCostUsd: result.metrics.costUsd,
    },
    probeRates,
  );
  return {
    ...result,
    metrics: { ...result.metrics, costUsd: priced.costUsd },
    costBasis: priced.basis,
  };
}
