/**
 * The ccbench candidate set — which ids on the IU Anthropic route are worth
 * spending a full agent-loop benchmark on, and which are documented dead ends.
 *
 * Every latency below is a single trivial `/messages` call measured live on
 * 2026-08-31 against `.../anthropic`. It is a reachability check, not a
 * benchmark result — the real numbers come from `bun run bench`.
 */
import { isClaudeModel } from "../pick/anthropic.js";
import type { RouteResidency } from "./route.js";

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

/**
 * Where each id physically lands, surveyed by `bun run route-map` on
 * 2026-08-31 (five samples per id — the backend is stable, not round-robined).
 *
 * Committed rather than queried because nothing persists it: residency is only
 * visible in the `x-middleware-forwarded-*` headers of a live `/messages` call,
 * and `GET /models`, `capability_probe` and `pick_probe` all fail to expose it.
 * Bedrock encodes the routing scope in the inference-profile prefix, so
 * `global.` is its own answer and must never be read as `eu` — that distinction
 * is the whole reason the `-eu` ids exist. Re-run `route-map` and update this
 * table when the route moves.
 */
export const ROUTE_RESIDENCY: Record<string, RouteResidency> = {
  "claude-opus-5": "eu", // eu.anthropic.claude-opus-5 — EU-pinned under its bare name
  "claude-fable-5": "eu", // Azure Global Sink Sweden
  "claude-opus-4-8-eu": "eu",
  "claude-haiku-4-5-eu": "eu",
  "claude-sonnet-4-6-eu": "eu",
  "claude-sonnet-5": "global",
  "claude-opus-4-8": "global",
  "claude-haiku-4-5": "global",
  "claude-sonnet-4-6": "us", // Vertex IU Group useast-5, not Bedrock eu-west-1
};

/**
 * Residency for one id. Anything the survey does not name falls back to what
 * the route structurally implies: every non-Claude id is a Requesty hop to the
 * original vendor, reports the same `Requesty Global Anthropic API` backend and
 * exposes nothing finer than `global`. An unsurveyed Claude id is honestly
 * `unknown` — guessing from the family name is how `claude-sonnet-4-6` gets
 * mistaken for an EU route.
 */
export function routeResidencyOf(modelId: string): RouteResidency {
  const surveyed = ROUTE_RESIDENCY[modelId];
  if (surveyed) return surveyed;
  return isClaudeModel(modelId) ? "unknown" : "global";
}

/**
 * Published context windows for the Claude candidates. The gateway reports a
 * flat 200K for every id it serves, so the CLI runs a 1M model as a 200K one
 * unless `CLAUDE_CODE_MAX_CONTEXT_TOKENS` says otherwise — these are the real
 * windows, not what the route advertises. Non-Claude ids get theirs from
 * `pick_probe`'s binary search instead.
 */
export const CLAUDE_CONTEXT_WINDOW: Record<string, number> = {
  "claude-haiku-4-5": 200_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-fable-5": 1_000_000,
};
