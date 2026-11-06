import { compareVersions, versionOf } from "../collectors/normalize.js";
import { SNAPSHOT_PINS } from "../collectors/snapshot-pins.js";
import type { Effort } from "./types.js";

// ── Slug parsing ─────────────────────────────────────────────────────────────

/** Efforts AA spells as a slug suffix. A bare slug carries none (see `resolveEfforts`). */
export type SuffixEffort = "none" | "low" | "medium" | "high" | "xhigh";

const SUFFIXES: ReadonlyArray<readonly [string, SuffixEffort]> = [
  ["-non-reasoning", "none"],
  ["-xhigh", "xhigh"],
  ["-medium", "medium"],
  ["-high", "high"],
  ["-low", "low"],
];

export interface ParsedVariant {
  /** The slug minus its effort suffix. */
  lineage: string;
  /** Null for a bare slug: `max` or `default` depending on its siblings. */
  effort: SuffixEffort | null;
}

export function parseVariant(slug: string): ParsedVariant {
  for (const [suffix, effort] of SUFFIXES) {
    if (slug.endsWith(suffix) && slug.length > suffix.length) {
      return { lineage: slug.slice(0, -suffix.length), effort };
    }
  }
  return { lineage: slug, effort: null };
}

/**
 * Effort per slug. A bare slug is `max` when its lineage has any other effort row in the
 * set, else `default` (a model with no effort control).
 */
export function resolveEfforts(slugs: readonly string[]): Map<string, Effort> {
  const parsed = slugs.map((slug) => [slug, parseVariant(slug)] as const);
  const lineagesWithEfforts = new Set(parsed.filter(([, p]) => p.effort !== null).map(([, p]) => p.lineage));
  return new Map(
    parsed.map(([slug, p]) => [slug, p.effort ?? (lineagesWithEfforts.has(p.lineage) ? "max" : "default")]),
  );
}

// ── Derived estimates ────────────────────────────────────────────────────────

export interface TaskEstimates {
  tokensPerTaskEst: number | null;
  timePerTaskEstSec: number | null;
}

/**
 * AA's free tier publishes no tokens or time per task, so both are derived. Validated once
 * against AA's published time per task: rank correlation 0.69, but overstated 2-4x for
 * Anthropic/OpenAI and up to 21x for input-heavy models (cost there is mostly input tokens).
 * Compare within one vendor or tier, never as an absolute.
 */
export function estimateTask(input: {
  costPerTask: number | null;
  priceOut: number | null;
  tps: number | null;
}): TaskEstimates {
  const { costPerTask, priceOut, tps } = input;
  const tokensPerTaskEst =
    costPerTask !== null && priceOut !== null && priceOut > 0 ? (costPerTask / priceOut) * 1e6 : null;
  const timePerTaskEstSec =
    tokensPerTaskEst !== null && tps !== null && tps > 0 ? tokensPerTaskEst / tps : null;
  return { tokensPerTaskEst, timePerTaskEstSec };
}

// ── Superseded logic ─────────────────────────────────────────────────────────

export interface LineageInfo {
  lineage: string;
  creator: string;
  /** Newest release date over the lineage's variants (YYYY-MM-DD) or null. */
  releaseDate: string | null;
}

export interface SupersededInfo {
  superseded: boolean;
  supersededBy: string | null;
}

const STALE_MONTHS = 12;
const MAX_VERSION_SEGMENT = 20;

/** (family, version) of a lineage or catalog id: `v4` -> `4`, a trailing 4-digit snapshot (`-1017`) dropped. */
export function versionKey(id: string): { family: string; version: string | null } {
  const normalised = id
    .toLowerCase()
    .replace(/(^|-)v(\d+)(?=[-.]|$)/g, "$1$2")
    .replace(/-\d{4}$/, "");
  const parsed = versionOf(normalised);
  // AA writes some old ids without the dash (`claude-35-sonnet` = 3.5): a segment that large is
  // a mangled version, not a high one, and would win every comparison. Age handles those.
  if (parsed.version?.split(".").some((seg) => Number(seg) >= MAX_VERSION_SEGMENT)) {
    return { family: parsed.family, version: null };
  }
  return parsed;
}

/**
 * Which lineages are no longer the current one. Per creator + family (`versionOf`) the highest
 * version is current; among equal versions (snapshots) the newest release date wins and a tie
 * keeps both. The rest point at the current lineage. A lineage whose newest release is over
 * 12 months old is superseded with `supersededBy: null`. A wrong hide is worse than a safe
 * miss, so there is no alias table: a rename across naming schemes stays visible.
 */
export function computeSuperseded(
  lineages: readonly LineageInfo[],
  now: Date = new Date(),
): Map<string, SupersededInfo> {
  const result = new Map<string, SupersededInfo>();
  const keyed = lineages.map((l) => ({ ...l, ...versionKey(l.lineage) }));

  const groups = new Map<string, typeof keyed>();
  for (const l of keyed) {
    if (l.version === null) continue;
    const key = `${l.creator}\u0000${l.family}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  for (const group of groups.values()) {
    const highest = group.reduce((a, b) => (compareVersions(b.version!, a.version!) > 0 ? b : a)).version!;
    const atHighest = group.filter((l) => compareVersions(l.version!, highest) === 0);
    const newest = atHighest.reduce((a, b) => ((b.releaseDate ?? "") > (a.releaseDate ?? "") ? b : a));
    const current = atHighest.filter((l) => (l.releaseDate ?? "") === (newest.releaseDate ?? ""));
    for (const l of group) {
      if (current.includes(l)) continue;
      result.set(l.lineage, { superseded: true, supersededBy: newest.lineage });
    }
  }

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - STALE_MONTHS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  for (const l of lineages) {
    if (result.has(l.lineage)) continue;
    const old = l.releaseDate !== null && l.releaseDate < cutoffIso;
    result.set(l.lineage, { superseded: old, supersededBy: null });
  }
  return result;
}

// ── Route mapping ────────────────────────────────────────────────────────────

export interface RouteVariant {
  variantSlug: string | null;
  reason: string | null;
}

/** `claude-` ids ride the Max subscription (agw prefers Claude there); everything else is billed. */
export function accessOf(modelId: string): "subscription" | "metered" {
  return modelId.startsWith("claude-") ? "subscription" : "metered";
}

/**
 * The AA slug a route's `(model, effort)` resolves to, among the scored slugs. Dots become
 * dashes, `SNAPSHOT_PINS` win over the undated slug, effort `none` is `-non-reasoning`, a
 * missing effort (or `max`/`default`) is the bare slug. Never falls back to another effort:
 * a different effort is a different cost and quality.
 */
export function routeVariant(input: {
  model: string;
  effort: string | null;
  scoredSlugs: ReadonlySet<string>;
}): RouteVariant {
  const { model, effort, scoredSlugs } = input;
  const id = model.replace(/\[.*\]$/, "");
  const base = SNAPSHOT_PINS[id] ?? id.toLowerCase().replace(/\./g, "-");
  const suffixed = effort === "none" ? "-non-reasoning" : effort && effort !== "max" && effort !== "default" ? `-${effort}` : "";
  const slug = `${base}${suffixed}`;
  if (scoredSlugs.has(slug)) return { variantSlug: slug, reason: null };
  return { variantSlug: null, reason: `no AA row at effort ${effort ?? "default"}` };
}
