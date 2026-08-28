// Binary-searches a non-Claude model's real context window: send `max_tokens:
// 1` against a filler user message of N (approx) tokens and read the
// rejection. The gateway's error text varies by provider — some name the
// number ("Your request exceeded model token limit: 262144"), most just say
// the input is too long, and one (qwen3.7-max) returns a request-body byte cap
// instead. A number in the message ends the search immediately; otherwise a
// coarse binary search runs between 8k and 1.1M. Landing within ~10% is the
// goal, not exactness — each probe costs money.
import { anthropicMessage } from "./anthropic.js";

export interface ContextWindowResult {
  /** null when the probe was inconclusive — never a fabricated fallback. */
  contextWindow: number | null;
  /** true only when the gateway named an exact token-limit number. */
  exact: boolean;
  note: string | null;
  callsUsed: number;
}

const FLOOR_TOKENS = 8_000;
const CEILING_TOKENS = 1_100_000;
const MAX_BINARY_SEARCH_ITERATIONS = 6;
const GRID_TOKENS = 1_000;

const FILLER_WORDS =
  "the quick brown fox jumps over the lazy dog while probing context window limits on the gateway ";

function buildFiller(approxTokens: number): string {
  // ~4 chars/token is the standard rough heuristic; exactness isn't the goal.
  const targetChars = approxTokens * 4;
  let out = "";
  while (out.length < targetChars) out += FILLER_WORDS;
  return out.slice(0, targetChars);
}

const TOKEN_LIMIT_RE = /(?:token|context)[^\d]{0,40}?(\d{4,9})/i;
const BYTE_CAP_RE = /(\d{4,9})\s*bytes?/i;
const OVERFLOW_WORDING_RE =
  /too long|context length|maximum context|exceed|too many tokens|input is too long|request (?:body )?too large|payload too large|token limit/i;

interface ProbeAtResult {
  fits: boolean | "unknown";
  message: string | null;
}

async function probeAt(modelId: string, approxTokens: number): Promise<ProbeAtResult> {
  const res = await anthropicMessage({
    model: modelId,
    max_tokens: 1,
    messages: [{ role: "user", content: buildFiller(approxTokens) }],
  });
  if (res.ok) return { fits: true, message: null };
  const message = res.errorText ?? "";
  if (OVERFLOW_WORDING_RE.test(message)) return { fits: false, message };
  // Some other failure (auth, rate limit, timeout) — inconclusive, not a
  // length rejection.
  return { fits: "unknown", message };
}

/** Discovers a non-Claude gateway model's real context window. One shot at the
 *  ceiling first — if the gateway names an exact number (tokens or a byte
 *  cap), that's used directly and the binary search is skipped. */
export async function discoverContextWindow(modelId: string): Promise<ContextWindowResult> {
  const first = await probeAt(modelId, CEILING_TOKENS);
  let callsUsed = 1;

  if (first.fits === true) {
    return {
      contextWindow: CEILING_TOKENS,
      exact: false,
      note: "accepted at the probe ceiling — real window may be larger",
      callsUsed,
    };
  }

  if (first.message) {
    const tokenMatch = first.message.match(TOKEN_LIMIT_RE);
    const tokenLimit = tokenMatch?.[1] ? Number(tokenMatch[1]) : null;
    if (tokenLimit) {
      return { contextWindow: tokenLimit, exact: true, note: null, callsUsed };
    }
    const byteMatch = first.message.match(BYTE_CAP_RE);
    const byteCap = byteMatch?.[1] ? Number(byteMatch[1]) : null;
    if (byteCap) {
      return {
        contextWindow: Math.round(byteCap / 4),
        exact: false,
        note: `derived from a ${byteCap}-byte request-body cap, not a named token limit`,
        callsUsed,
      };
    }
  }

  if (first.fits === "unknown") {
    // Report nothing rather than the floor. A timeout or a 429 is not evidence
    // of a small window, and a fabricated 8k would be copied into a launcher's
    // context budget as if it had been measured.
    return {
      contextWindow: null,
      exact: false,
      note: `context probe inconclusive: ${first.message ?? "no error detail"}`,
      callsUsed,
    };
  }

  // Generic overflow, no explicit number — coarse binary search.
  let low = FLOOR_TOKENS;
  let high = CEILING_TOKENS;
  let iterations = 0;
  let inconclusive = false;
  while (high - low > low * 0.1 && iterations < MAX_BINARY_SEARCH_ITERATIONS) {
    const mid = Math.round((low + high) / 2 / GRID_TOKENS) * GRID_TOKENS;
    const result = await probeAt(modelId, mid);
    callsUsed++;
    iterations++;
    if (result.fits === true) {
      low = mid;
    } else if (result.fits === false) {
      high = mid;
    } else {
      inconclusive = true;
      break; // stop and report the best bound found so far
    }
  }

  // `low` is only meaningful once at least one probe came back conclusive.
  if (inconclusive && low === FLOOR_TOKENS) {
    return { contextWindow: null, exact: false, note: "context probe inconclusive", callsUsed };
  }
  return { contextWindow: low, exact: false, note: null, callsUsed };
}
