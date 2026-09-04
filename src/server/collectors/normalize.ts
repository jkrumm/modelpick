import type { MetricSource } from "../../db/schema.js";

export interface NormalizedMetric {
  model_id: string;
  source: MetricSource;
  metric: string;
  value: number;
  confidence: number;
}

export interface CollectorResult {
  metrics: NormalizedMetric[];
  unmatched: { externalId: string; name: string }[];
}

export type IdResolver = (externalId: string) => string | null;

// Tokens that are noise for cross-source matching — residency/variant markers and
// "latest" pointers that one source carries and another omits. Size/effort tokens
// (mini, nano, pro, flash, turbo, large, small) are NOT noise and are kept.
const NOISE_TOKENS = new Set([
  "latest",
  "eu",
  "us",
  "gdpr",
  "fast",
  "preview",
  "instruct",
  "stable",
]);

/** Lowercase, provider-prefix-stripped, date-stripped, noise-filtered token list —
 *  the shared normalization step behind both `canon()` (identity match) and
 *  `versionOf()` (version-aware match). */
function tokenize(id: string): string[] {
  let s = id.toLowerCase();
  if (s.includes("/")) s = s.split("/").slice(1).join("/");
  s = s.replace(/[._]/g, "-");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""); // 2025-04-16
  s = s.replace(/\b\d{8}\b/g, ""); // 20251101
  s = s.replace(/-\d{2}-\d{2}\b/g, ""); // -05-06
  s = s.replace(/-20\d{2}\b/g, ""); // -2026
  return s.split("-").filter((t) => t && !NOISE_TOKENS.has(t));
}

/** Canonical form of a model id: provider prefix, dates and noise tokens removed. */
export function canon(id: string): string {
  return tokenize(id).join("-");
}

export interface ModelVersion {
  /** Everything but the version run, e.g. "gemini-flash", "claude-opus". Tier
   *  words (flash/pro/lite/mini) stay here — only a *purely* numeric token run
   *  is ever pulled out as a version. */
  family: string;
  /** Dotted version string, e.g. "3.5", "4.8". Null when the id carries no
   *  contiguous numeric token run (most ids — this is the common case). */
  version: string | null;
}

/**
 * Splits an id into (family, version) by reusing `tokenize()`'s normalization
 * and pulling the maximal contiguous run of purely-numeric tokens out as the
 * version instead of discarding it. `gemini-3-5-flash` -> family
 * "gemini-flash", version "3.5"; `claude-opus-4-8` -> family "claude-opus",
 * version "4.8".
 *
 * This only catches same-convention numeric bumps. A rename across naming
 * schemes (`gpt-4` vs `gpt-5.6-luna` — "luna" breaks the family) is left
 * uncollapsed on purpose: two live naming schemes both staying visible is
 * safe, a wrong "superseded" hide is not. Do not close this gap with a
 * hand-maintained alias table — that trades a safe miss for an unsafe hit.
 */
export function versionOf(id: string): ModelVersion {
  const tokens = tokenize(id);

  let runStart = -1;
  let runEnd = -1;
  let bestLen = 0;
  let i = 0;
  while (i < tokens.length) {
    if (/^\d+$/.test(tokens[i] ?? "")) {
      const start = i;
      while (i < tokens.length && /^\d+$/.test(tokens[i] ?? "")) i++;
      const len = i - start;
      if (len > bestLen) {
        bestLen = len;
        runStart = start;
        runEnd = i;
      }
    } else {
      i++;
    }
  }

  if (runStart === -1) return { family: tokens.join("-"), version: null };

  return {
    family: [...tokens.slice(0, runStart), ...tokens.slice(runEnd)].join("-"),
    version: tokens.slice(runStart, runEnd).join("."),
  };
}

/** Numeric, segment-by-segment version comparison — never lexicographic, so
 *  "3.10" beats "3.9" (a string compare would get this backwards). */
export function compareVersions(a: string, b: string): number {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function tokenSet(id: string): string {
  return canon(id).split("-").filter(Boolean).toSorted().join("-");
}

/**
 * Builds a resolver mapping an external (leaderboard) model id to a local catalog
 * id. Strategy, most precise first: exact → provider-prefix-stripped exact →
 * canonical-form equality → token-set equality. Precomputes indexes once so each
 * lookup is O(1)-ish over a few hundred external ids.
 */
export function createIdResolver(knownIds: string[]): IdResolver {
  const exact = new Set(knownIds);
  const byCanon = new Map<string, string>();
  const byTokenSet = new Map<string, string>();
  for (const id of knownIds) {
    // First writer wins so the shortest/cleanest id keeps the slot for collisions.
    const c = canon(id);
    if (c && !byCanon.has(c)) byCanon.set(c, id);
    const ts = tokenSet(id);
    if (ts && !byTokenSet.has(ts)) byTokenSet.set(ts, id);
  }

  return (externalId: string): string | null => {
    if (exact.has(externalId)) return externalId;
    if (externalId.includes("/")) {
      const stripped = externalId.split("/").slice(1).join("/");
      if (exact.has(stripped)) return stripped;
    }
    return byCanon.get(canon(externalId)) ?? byTokenSet.get(tokenSet(externalId)) ?? null;
  };
}
