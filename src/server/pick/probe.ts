// Orchestrates the full live probe for one non-Claude model on the IU
// Anthropic-protocol route: cost solve, cache-read detection, max_tokens
// honouring + thinking detection, and context-window discovery.
import { solveCost } from "./cost-solve.js";
import { probeCache } from "./cache-probe.js";
import { probeMaxTokens } from "./max-tokens-probe.js";
import { discoverContextWindow } from "./context-window.js";
import { SEED_PRICES } from "./seed-prices.js";

export interface PickProbeResult {
  modelId: string;
  priceInPerM: number | null;
  priceOutPerM: number | null;
  priceCacheReadPerM: number | null;
  supportsCacheRead: boolean;
  honorsMaxTokens: boolean;
  alwaysThinking: boolean;
  contextWindow: number | null;
  contextWindowExact: boolean;
  notes: string[];
}

export async function probePickModel(modelId: string): Promise<PickProbeResult> {
  const [costResult, cacheResult, maxTokensResult] = await Promise.all([
    solveCost(modelId),
    probeCache(modelId),
    probeMaxTokens(modelId),
  ]);
  const ctxResult = await discoverContextWindow(modelId);

  const notes = [costResult.note, cacheResult.note, maxTokensResult.note, ctxResult.note].filter(
    (n): n is string => n !== null,
  );

  const seed = SEED_PRICES[modelId];

  return {
    modelId,
    priceInPerM: costResult.priceInPerM ?? seed?.priceInPerM ?? null,
    priceOutPerM: costResult.priceOutPerM ?? seed?.priceOutPerM ?? null,
    // Cache-read $/M isn't independently solved live (that needs a third
    // equation) — the seed table's least-squares value fills it in once
    // support is confirmed live.
    priceCacheReadPerM: cacheResult.supportsCacheRead ? (seed?.priceCacheReadPerM ?? null) : null,
    supportsCacheRead: cacheResult.supportsCacheRead,
    honorsMaxTokens: maxTokensResult.honorsMaxTokens,
    alwaysThinking: maxTokensResult.hasThinking,
    contextWindow: ctxResult.contextWindow,
    contextWindowExact: ctxResult.exact,
    notes,
  };
}
