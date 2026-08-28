// Detects whether a model honours `max_tokens` and whether it always emits a
// `thinking` content block. One call does both: a tight cap against a prompt
// that would naturally run long, so a truncated response proves the cap was
// respected (`stop_reason: "max_tokens"`) while an ignored cap runs the count
// to completion (`stop_reason: "end_turn"`, 2000+ output tokens).
import { anthropicMessage } from "./anthropic.js";

export interface MaxTokensProbeResult {
  honorsMaxTokens: boolean;
  hasThinking: boolean;
  note: string | null;
}

const COUNT_PROMPT = "Count from 1 to 300, comma separated.";
const REQUESTED_MAX_TOKENS = 64;

export async function probeMaxTokens(modelId: string): Promise<MaxTokensProbeResult> {
  const res = await anthropicMessage({
    model: modelId,
    max_tokens: REQUESTED_MAX_TOKENS,
    messages: [{ role: "user", content: COUNT_PROMPT }],
  });

  if (!res.ok) {
    return {
      honorsMaxTokens: false,
      hasThinking: false,
      note: `max_tokens probe call failed: ${res.errorText ?? ""}`,
    };
  }

  const honorsMaxTokens = res.stopReason === "max_tokens";
  return {
    honorsMaxTokens,
    hasThinking: res.hasThinking,
    note: honorsMaxTokens
      ? null
      : `ignored max_tokens=${REQUESTED_MAX_TOKENS} — stop_reason="${res.stopReason ?? "null"}", output_tokens=${res.usage?.output_tokens ?? "?"}`,
  };
}
