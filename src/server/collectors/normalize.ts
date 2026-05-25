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

/** Canonical form of a model id: provider prefix, dates and noise tokens removed. */
export function canon(id: string): string {
  let s = id.toLowerCase();
  if (s.includes("/")) s = s.split("/").slice(1).join("/");
  s = s.replace(/[._]/g, "-");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""); // 2025-04-16
  s = s.replace(/\b\d{8}\b/g, ""); // 20251101
  s = s.replace(/-\d{2}-\d{2}\b/g, ""); // -05-06
  s = s.replace(/-20\d{2}\b/g, ""); // -2026
  const tokens = s.split("-").filter((t) => t && !NOISE_TOKENS.has(t));
  return tokens.join("-");
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
