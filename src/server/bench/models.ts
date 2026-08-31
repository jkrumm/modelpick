/**
 * The ccbench candidate set — which ids on the IU Anthropic route are worth
 * spending a full agent-loop benchmark on, and which are documented dead ends.
 *
 * Every latency below is a single trivial `/messages` call measured live on
 * 2026-08-31 against `.../anthropic`. It is a reachability check, not a
 * benchmark result — the real numbers come from `bun run bench`.
 */

/** The default field. Six ids, all verified 200 on the Anthropic route. */
export const CCBENCH_MODELS: readonly string[] = [
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-5",
];

/** One short note per candidate — why it is in the field, plus the quirk that
 *  will show up in its transcript if there is one. */
export const MODEL_NOTES: Record<string, string> = {
  "claude-fable-5":
    "200 / 3549ms — emits thinking blocks by default, so expect thinking tokens on every turn",
  "claude-haiku-4-5": "200 / 978ms — fastest door on the route; the cheap-tier candidate",
  "claude-sonnet-4-6": "200 / 1247ms — the incumbent workhorse tier",
  "claude-sonnet-5": "200 / 1930ms — newer sonnet, slower first call than 4-6",
  "claude-opus-4-8": "200 / 1197ms — current orchestrator pick in My Stack",
  "claude-opus-5": "200 / 1472ms — top tier, the cost ceiling of the field",
};

/**
 * EU-residency twins. Not part of the default field: they are benchmarked
 * separately, against their non-EU parent, to price the latency/residency
 * trade rather than to rank them as different models.
 */
export const EU_VARIANTS: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-4-5-eu",
  "claude-sonnet-4-6": "claude-sonnet-4-6-eu",
  "claude-opus-4-8": "claude-opus-4-8-eu",
};

/**
 * `-eu` aliases that answer a plain `/messages` call but cannot run a Claude
 * Code session at all.
 *
 * Claude Code sends `context_management: clear_thinking_20251015` on every
 * request. These ids reject it — and the gateway surfaces that rejection as a
 * **503 `server_error`** rather than the 400 it is, so the CLI treats it as
 * retryable, burns all 10 retries and dies after ~190s having taken zero turns.
 * Verified by bisection: the identical request minus `context_management`
 * returns 200 from these ids, and the non-`-eu` parents accept the full shape.
 * `claude-sonnet-4-6-eu` is unaffected and works normally.
 *
 * Reachability probes cannot see this — the failure needs the CLI's own request
 * shape — which is why a `/messages` 200 is not evidence a model is usable.
 */
export const CLAUDE_CODE_INCOMPATIBLE: readonly string[] = [
  "claude-haiku-4-5-eu",
  "claude-opus-4-8-eu",
];

/** True when an id is served and answers probes, but cannot drive a Claude
 *  Code session. See CLAUDE_CODE_INCOMPATIBLE for why. */
export function isClaudeCodeIncompatible(modelId: string): boolean {
  return CLAUDE_CODE_INCOMPATIBLE.includes(modelId);
}

/**
 * Listed by the route, 503 on every call. Recorded so nobody spends another
 * probe cycle rediscovering that the catalog lies about them.
 */
export const DEAD_IDS: readonly string[] = [
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-latest",
  "claude-opus-4-0",
  "claude-sonnet-4-0",
];

/** True when an id is known-dead — the CLI would just burn a timeout on it. */
export function isDeadModel(modelId: string): boolean {
  return DEAD_IDS.includes(modelId);
}
