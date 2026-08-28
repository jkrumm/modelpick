// Detects prompt-caching support: sends the SAME ~3000-token `system` block
// (marked `cache_control: {type: "ephemeral"}`) twice and checks whether the
// second call's `usage.cache_read_input_tokens` comes back non-zero. This is a
// yes/no detection, not a price solve — the cache-read $/M rate comes from
// SEED_PRICES (already solved by least squares) when a model supports it.
import { anthropicMessage, type AnthropicSystemBlock } from "./anthropic.js";

export interface CacheProbeResult {
  supportsCacheRead: boolean;
  note: string | null;
}

const CACHE_FILLER_PARAGRAPH =
  "This is a fixed reference passage used to probe prompt-caching support on the IU " +
  "gateway's Anthropic-protocol route. It is repeated verbatim across both calls so a " +
  "cache hit is possible on the second one. ";
const CACHE_TARGET_TOKENS = 3000;
const CACHE_MAX_TOKENS = 8;

function buildCacheFiller(): string {
  let text = "";
  while (text.length < CACHE_TARGET_TOKENS * 4) text += CACHE_FILLER_PARAGRAPH;
  return text;
}

export async function probeCache(modelId: string): Promise<CacheProbeResult> {
  const system: AnthropicSystemBlock[] = [
    { type: "text", text: buildCacheFiller(), cache_control: { type: "ephemeral" } },
  ];

  const first = await anthropicMessage({
    model: modelId,
    max_tokens: CACHE_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: "Reply with exactly one word: ok." }],
  });
  const second = await anthropicMessage({
    model: modelId,
    max_tokens: CACHE_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: "Reply with exactly one word: ok." }],
  });

  if (!first.ok || !second.ok) {
    return {
      supportsCacheRead: false,
      note: `cache-probe call failed: ${first.errorText ?? second.errorText ?? ""}`,
    };
  }

  const cacheRead = second.usage?.cache_read_input_tokens ?? 0;
  return {
    supportsCacheRead: cacheRead > 0,
    note: cacheRead > 0 ? null : "no cache_read_input_tokens on the repeat call",
  };
}
