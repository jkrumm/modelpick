// Solves per-token input/output pricing from two `/messages` calls with
// distinct actual output lengths, using the gateway's `usage.cost` field
// (present only on the Requesty-proxied non-Claude models). Two calls, two
// unknowns:
//   priceIn * (inA/1e6) + priceOut * (outA/1e6) = costA
//   priceIn * (inB/1e6) + priceOut * (outB/1e6) = costB
// The two calls use deliberately different prompts (not just different
// `max_tokens`), so the actual output length still diverges even for a model
// that ignores `max_tokens` entirely.
import { anthropicMessage } from "./anthropic.js";

export interface CostSolveResult {
  priceInPerM: number | null;
  priceOutPerM: number | null;
  reliable: boolean;
  note: string | null;
}

const SHORT_PROMPT = "Reply with exactly one word: yes.";
const LONG_PROMPT =
  "Write a detailed ~600 word explanation of how TCP congestion control works, " +
  "covering slow start, congestion avoidance, and fast retransmit.";
const SHORT_MAX_TOKENS = 40;
const LONG_MAX_TOKENS = 900;

export async function solveCost(modelId: string): Promise<CostSolveResult> {
  const [short, long] = await Promise.all([
    anthropicMessage({
      model: modelId,
      max_tokens: SHORT_MAX_TOKENS,
      messages: [{ role: "user", content: SHORT_PROMPT }],
    }),
    anthropicMessage({
      model: modelId,
      max_tokens: LONG_MAX_TOKENS,
      messages: [{ role: "user", content: LONG_PROMPT }],
    }),
  ]);

  if (!short.ok || !long.ok) {
    return {
      priceInPerM: null,
      priceOutPerM: null,
      reliable: false,
      note: `cost-solve call failed: ${short.errorText ?? long.errorText ?? "unknown"}`,
    };
  }

  const inA = short.usage?.input_tokens ?? null;
  const outA = short.usage?.output_tokens ?? null;
  const costA = short.usage?.cost ?? null;
  const inB = long.usage?.input_tokens ?? null;
  const outB = long.usage?.output_tokens ?? null;
  const costB = long.usage?.cost ?? null;

  if (costA === null || costB === null) {
    return {
      priceInPerM: null,
      priceOutPerM: null,
      reliable: false,
      note: "no usage.cost on this model — real Claude route (Bedrock/Azure), not Requesty-proxied",
    };
  }
  if (inA === null || outA === null || inB === null || outB === null) {
    return {
      priceInPerM: null,
      priceOutPerM: null,
      reliable: false,
      note: "usage block missing token counts",
    };
  }

  const a = inA / 1e6;
  const b = outA / 1e6;
  const c = inB / 1e6;
  const d = outB / 1e6;
  const det = a * d - b * c;

  if (Math.abs(det) < 1e-9) {
    return {
      priceInPerM: null,
      priceOutPerM: null,
      reliable: false,
      note: "output lengths too similar to solve a 2x2 system",
    };
  }

  const priceIn = (costA * d - costB * b) / det;
  const priceOut = (a * costB - c * costA) / det;

  if (priceIn < 0 || priceOut < 0) {
    return {
      priceInPerM: null,
      priceOutPerM: null,
      reliable: false,
      note: "solved a negative price — discarded",
    };
  }

  return { priceInPerM: priceIn, priceOutPerM: priceOut, reliable: true, note: null };
}
