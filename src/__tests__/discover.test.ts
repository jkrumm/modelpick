import { describe, it, expect } from "vitest";
import { deriveProvider } from "../server/iu/discover.js";

// ── deriveProvider — previously-unclassified ("other") ids ─────────────────────────

const NOW_CLASSIFIED: [string, string][] = [
  ["GLM-4.5", "zhipu"],
  ["GLM-5", "zhipu"],
  ["GLM-5.1", "zhipu"],
  ["GLM-5.2", "zhipu"],
  ["GLM-5.3", "zhipu"],
  ["glm-5.2", "zhipu"],
  ["glm-5.2-fast", "zhipu"],
  ["glm-5.3", "zhipu"],
  ["glm-5.3-flash", "zhipu"],
  ["Kimi-K2.5", "moonshot"],
  ["Kimi-K2.6", "moonshot"],
  ["kimi-k2.7-code", "moonshot"],
  ["kimi-k3", "moonshot"],
  ["MiniMax-M2.5", "minimax"],
  ["minimax-m3", "minimax"],
  ["MiMo-V2.5-Pro", "xiaomi"],
  ["NVIDIA-Nemotron-3-Super-120B-A12B", "nvidia"],
  ["nemotron-3-ultra", "nvidia"],
  ["Hermes-4-405B", "nousresearch"],
  ["Hy3", "tencent"],
  ["hy3", "tencent"],
  ["codestral-2", "mistral"],
  ["codestral-2508", "mistral"],
  ["codestral-embed", "mistral"],
  ["codestral-embed-2505", "mistral"],
  ["codestral-latest", "mistral"],
  ["devstral-2512", "mistral"],
  ["devstral-latest", "mistral"],
  ["devstral-medium-2507", "mistral"],
  ["devstral-medium-latest", "mistral"],
  ["devstral-small-2507", "mistral"],
  ["magistral-medium-latest", "mistral"],
  ["ministral-14b-2512", "mistral"],
  ["ministral-14b-latest", "mistral"],
  ["ministral-3b-2512", "mistral"],
  ["ministral-3b-latest", "mistral"],
  ["ministral-8b-2512", "mistral"],
  ["ministral-8b-latest", "mistral"],
  ["pixtral-large-2411", "mistral"],
  ["pixtral-large-latest", "mistral"],
  ["voxtral-mini-2507", "mistral"],
  ["voxtral-mini-2602", "mistral"],
  ["voxtral-mini-latest", "mistral"],
  ["voxtral-mini-realtime-2602", "mistral"],
  ["voxtral-mini-realtime-latest", "mistral"],
  ["voxtral-mini-transcribe-2507", "mistral"],
  ["voxtral-mini-transcribe-realtime-2602", "mistral"],
  ["voxtral-mini-tts-2603", "mistral"],
  ["voxtral-mini-tts-latest", "mistral"],
  ["voxtral-small-2507", "mistral"],
  ["voxtral-small-latest", "mistral"],
  ["nano-banana", "google"],
  ["nano-banana-2", "google"],
  ["nano-banana-pro", "google"],
  ["sonar", "perplexity"],
  ["sonar-deep-research", "perplexity"],
  ["sonar-pro", "perplexity"],
  ["sonar-reasoning", "perplexity"],
  ["sonar-reasoning-pro", "perplexity"],
  ["omni-moderation-2024-09-26", "openai"],
  ["omni-moderation-latest", "openai"],
];

describe("deriveProvider — previously-unclassified ids", () => {
  it.each(NOW_CLASSIFIED)("classifies %s as %s", (id, provider) => {
    expect(deriveProvider(id)).toBe(provider);
  });
});

// ── deriveProvider — pre-existing mappings must still hold ─────────────────────────

const PRE_EXISTING: [string, string][] = [
  ["claude-opus-5", "anthropic"],
  ["gpt-5.6-luna", "openai"],
  ["o3-mini", "openai"],
  ["gemini-3.8-flash", "google"],
  ["DeepSeek-V4-Flash", "deepseek"],
  ["Qwen/Qwen3.5-397B-A17B", "qwen"],
  ["mistral-large-2512", "mistral"],
];

describe("deriveProvider — pre-existing mappings", () => {
  it.each(PRE_EXISTING)("still classifies %s as %s", (id, provider) => {
    expect(deriveProvider(id)).toBe(provider);
  });
});

// ── deriveProvider — fallback behaviour ─────────────────────────────────────────────

describe("deriveProvider — fallback behaviour", () => {
  it("falls back to the HF-style prefix for an unknown vendor", () => {
    expect(deriveProvider("SomeUnknownVendor/some-model-x")).toBe("someunknownvendor");
  });

  // Was `other` until a live call identified it: the response carries
  // `x-middleware-forwarded-model: gpt-4.1` from the West Europe OAI server, so this
  // is IU's own alias for GPT-4.1. Evidence, not inference — keep it that way.
  it("maps premium-4.1 to openai on the strength of its forwarded-model header", () => {
    expect(deriveProvider("premium-4.1")).toBe("openai");
  });
});
