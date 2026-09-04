/**
 * Pure presentation helpers for the ccbench summary — no DB, no fs, no clock.
 *
 * MUST NEVER import `db`, `schema`, or anything that transitively reaches
 * them. `src/db/index.ts` constructs the libsql client at module scope, so a
 * *value* import chain that reaches it (even indirectly, via `summary.ts`)
 * drags the whole libsql node client into whatever bundle imports it. The
 * `/bench` route imports these formatters directly into a client component;
 * the libsql client throws `Neon: unsupported system: undefined` the moment
 * it lands in a browser bundle — a failure SSR/`curl` cannot see, because the
 * server bundle tolerates the dead code just fine. Keep this file's import
 * graph free of `db` and it stays safe to import from anywhere, including
 * client components.
 */
import type { CostBasis } from "./types.js";

export const MISSING = "—";

// ── external index ───────────────────────────────────────────────────────────

/** ArtificialAnalysis's two columns for one model, most recent capture each. */
export interface AaIndex {
  /** AA's intelligence index (their `quality` metric), 0..100ish. */
  intelligence: number | null;
  /** AA's coding index. */
  coding: number | null;
  capturedAt: string | null;
  /** The AA id these came from — not always the route's id. */
  sourceId: string;
  /** True when `sourceId` is a near neighbour rather than the same model, so
   *  the number is an upper bound and the table has to say so. */
  approximate: boolean;
}

/** AA's intelligence / coding index for a row, or null when the leaderboard
 *  never rated it. One accessor each, so no call site has to reach through an
 *  optional chain and compare it loosely against null. */
export function aaIntelligenceOf(row: { aa: AaIndex | null }): number | null {
  return row.aa?.intelligence ?? null;
}

export function aaCodingOf(row: { aa: AaIndex | null }): number | null {
  return row.aa?.coding ?? null;
}

// ── rate card ────────────────────────────────────────────────────────────────

/** What a model costs per MTok and how much it can hold, with the basis
 *  attached — a price without its basis is the bug `cost.ts` exists for. */
export interface RateCard {
  inPerM: number | null;
  outPerM: number | null;
  contextWindow: number | null;
  /** False when the window is a binary-search estimate rather than a number the
   *  gateway or the vendor named exactly. */
  contextWindowExact: boolean;
  /** `pick_probe`'s caveats, already split. */
  notes: string[];
  /** `measured` = solved from the gateway's own billing; `list` = the committed
   *  Anthropic card; null = neither knows this id. */
  basis: "measured" | "list" | null;
}

// ── cost basis + caveats ─────────────────────────────────────────────────────

/** A model whose own runs disagree about their basis — a real finding, not a
 *  rendering problem, so it gets its own label rather than a first-wins guess. */
export type BasisLabel = CostBasis | "mixed";

/** The three things a reader of the table must not miss. */
export interface BenchCaveats {
  /** How many eligible rows scored a flat 1.00 — the saturation the quality
   *  column hides. */
  perfectCount: number;
  scoredCount: number;
  /** AA's spread over the same field, which is what makes the saturation
   *  obvious rather than assertable. */
  aaSpread: {
    low: number;
    lowModelId: string;
    high: number;
    highModelId: string;
  } | null;
  costBasis: BasisLabel;
  /** How many rows carried each basis — `mixed` counts models whose own runs
   *  disagreed, which is a finding rather than a rendering problem. */
  basisCounts: Record<BasisLabel, number>;
  /** Non-Claude ids in the field — every one a Requesty hop to the vendor. */
  requestyIds: string[];
}

/** The caveat block, rendered once so the CLI and the page cannot drift apart.
 *  Three lines, in the order a reader needs them. */
export function caveatLines(caveats: BenchCaveats): string[] {
  const lines: string[] = [];

  const saturation =
    caveats.aaSpread === null
      ? `${caveats.perfectCount} of ${caveats.scoredCount} models scored a flat 1.00 — this column measures harness fitness, not capability.`
      : `${caveats.perfectCount} of ${caveats.scoredCount} models scored a flat 1.00, while ArtificialAnalysis spreads the same field ${caveats.aaSpread.low.toFixed(1)} (${caveats.aaSpread.lowModelId}) to ${caveats.aaSpread.high.toFixed(1)} (${caveats.aaSpread.highModelId}). The quality column measures harness fitness, not capability.`;
  lines.push(saturation);

  lines.push(
    caveats.costBasis === "mixed"
      ? `Cost basis is per row: ${caveats.basisCounts.measured} measured (per-token rates solved from the gateway's own billing), ${caveats.basisCounts.list} Anthropic list, ${caveats.basisCounts.unpriced} unpriced, ${caveats.basisCounts.mixed} mixed within their own runs. Never an IU invoice.`
      : `Cost basis: ${caveats.costBasis} for every row. Never an IU invoice.`,
  );

  lines.push(
    caveats.requestyIds.length === 0
      ? "Every id in this field is a real Claude route (Bedrock/Azure)."
      : `${caveats.requestyIds.length} non-Claude id(s) — ${caveats.requestyIds.join(", ")} — are a Requesty hop to the original vendor; "global" is the finest residency the route exposes for them.`,
  );

  return lines;
}

// ── formatting, shared by both renderers ─────────────────────────────────────

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

export function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return MISSING;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  return `${Math.round(value * 100)}%`;
}

export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  return value.toFixed(2);
}

export function formatContext(rate: RateCard): string {
  if (rate.contextWindow === null) return MISSING;
  const approx = rate.contextWindowExact ? "" : "~";
  if (rate.contextWindow >= 1_000_000) return `${approx}${(rate.contextWindow / 1e6).toFixed(1)}M`;
  return `${approx}${Math.round(rate.contextWindow / 1000)}K`;
}
