// Baseline pricing for the non-Claude models on the IU Anthropic-protocol
// route, measured 2026-08-28 by least-squares solve over four request shapes
// per model (0.0% residual), confirmed identical on the /openai route. Used as
// the fallback so a fresh `pick` run without probing (or a model a live probe
// couldn't solve) still renders a full comparison table — a live probe
// overwrites these once cached in pick_probe.
export interface SeedPriceEntry {
  priceInPerM: number;
  priceOutPerM: number;
  /** null = no prompt-caching discount observed for this model. */
  priceCacheReadPerM: number | null;
}

export const SEED_PRICES: Record<string, SeedPriceEntry> = {
  "glm-5.3-flash": { priceInPerM: 0.075, priceOutPerM: 0.25, priceCacheReadPerM: 0.015 },
  "NVIDIA-Nemotron-3-Super-120B-A12B": {
    priceInPerM: 0.1,
    priceOutPerM: 0.5,
    priceCacheReadPerM: null,
  },
  hy3: { priceInPerM: 0.14, priceOutPerM: 0.58, priceCacheReadPerM: 0.035 },
  "minimax-m3": { priceInPerM: 0.3, priceOutPerM: 1.2, priceCacheReadPerM: 0.06 },
  "DeepSeek-V4-Flash": { priceInPerM: 0.44, priceOutPerM: 1.32, priceCacheReadPerM: 0.014 },
  "nemotron-3-ultra": { priceInPerM: 0.6, priceOutPerM: 2.4, priceCacheReadPerM: 0.12 },
  "kimi-k2.7-code": { priceInPerM: 0.95, priceOutPerM: 4.0, priceCacheReadPerM: 0.19 },
  "MiMo-V2.5-Pro": { priceInPerM: 1.0, priceOutPerM: 3.0, priceCacheReadPerM: 0.2 },
  "DeepSeek-V4-Pro": { priceInPerM: 1.32, priceOutPerM: 3.96, priceCacheReadPerM: 0.044 },
  "GLM-5.1": { priceInPerM: 1.4, priceOutPerM: 4.4, priceCacheReadPerM: 0.26 },
  "glm-5.2": { priceInPerM: 1.4, priceOutPerM: 4.4, priceCacheReadPerM: 0.14 },
  "qwen3.7-max": { priceInPerM: 2.5, priceOutPerM: 7.5, priceCacheReadPerM: null },
};

// Known quirks (measured 2026-08-28) — seed a fresh comparison table with these
// even before a live probe confirms them.
export const KNOWN_IGNORES_MAX_TOKENS = new Set(["glm-5.3-flash", "GLM-5.1"]);
export const KNOWN_CONTEXT_WINDOW: Record<string, number> = { "kimi-k2.7-code": 262144 };
export const KNOWN_BYTE_CAP: Record<string, number> = { "qwen3.7-max": 6291456 };
// Every non-Claude model on this route always emits `thinking` blocks and
// cannot be told not to — true unless a live probe someday finds an exception.
export const ALWAYS_THINKING_DEFAULT = true;

/** Default context window shown when neither a live probe nor a known quirk
 *  has narrowed it down — deliberately conservative (not a measured value). */
export const DEFAULT_CONTEXT_WINDOW_GUESS = 200_000;
