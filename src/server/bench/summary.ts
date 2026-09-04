/**
 * One derivation behind both `bun run cap` and the `/bench` route: pick the
 * suite, join the measured ccbench columns to the external index and the real
 * rate card, and derive the three picks the decision doc argues for.
 *
 * Why it exists as its own module: a CLI that says one thing and a page that
 * says another is worse than having neither, and the picks are the part most
 * likely to drift. `buildBenchSummary` is pure — rows in, shape out, no DB, no
 * fs, no clock — so every pick rule is testable against a synthetic field, and
 * `loadBenchSummary` is the thin adapter that reads `modelpick.db`.
 *
 * The join is the interesting part. Three sources disagree about names and
 * about what they even measure:
 *  - `bench_run` measures *harness fitness* — can a model drive the agent loop.
 *    On the current field that column is saturated, so it does not rank
 *    intelligence and must not be read as if it did.
 *  - `metric_snapshot` (ArtificialAnalysis) measures intelligence, under ids
 *    that only sometimes match the route's (`glm-5.3-flash` vs `GLM-5.3`).
 *  - `pick_probe` measures per-token rates solved from the gateway's own
 *    billing, for the non-Claude ids only; Claude takes the committed list card.
 */
import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { benchRun, metricSnapshot, pickProbe } from "../../db/schema.js";
import type { BenchRun } from "../../db/schema.js";
import { isClaudeModel } from "../pick/anthropic.js";
import { CLAUDE_LIST_RATES, normaliseModelId } from "./cost.js";
import {
  CLAUDE_CODE_INCOMPATIBLE,
  CLAUDE_CONTEXT_WINDOW,
  DEAD_IDS,
  isClaudeCodeIncompatible,
  isDeadModel,
  routeResidencyOf,
} from "./models.js";
import type { RouteResidency } from "./route.js";
import { composite, perModel, perTask, type PerTaskScore } from "./score.js";
import type { BenchCheck, BenchFailure, BenchRunResult, CostBasis } from "./types.js";

/** A model whose own runs disagree about their basis — a real finding, not a
 *  rendering problem, so it gets its own label rather than a first-wins guess. */
export type BasisLabel = CostBasis | "mixed";

/** A quality of exactly 1.00 after floating-point averaging. */
const PERFECT = 1 - 1e-9;

/** A suite has to separate a field before it can pick from one. Below this the
 *  newest suite is a spot-check (an EU twin pair, a timeout retest), not a
 *  ranking, and defaulting to it would quietly answer a different question. */
export const MIN_SUITE_MODELS = 5;

/** The documented EU answer when nothing in the field surveys as EU-resident.
 *  Only ever offered when it is actually in the field — see `derivePicks`. */
export const EU_FALLBACK_ID = "claude-opus-5";

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

/**
 * Route id → AA id, for the pairs no normalisation can close. AA rates the full
 * `GLM-5.3`; the route serves the flash variant, which its vendor puts a few
 * points below — so this reads as an upper bound, never a match. Keys and
 * values are already normalised + lowercased.
 */
const AA_ALIASES: Record<string, string> = {
  "glm-5.3-flash": "glm-5.3",
};

/** The subset of `metric_snapshot` this needs — a real row satisfies it. */
export interface AaMetricRow {
  model_id: string;
  metric: string;
  value: number;
  captured_at: string;
}

export type AaLookup = Map<string, AaIndex>;

function aaKey(modelId: string): string {
  const normalised = normaliseModelId(modelId).toLowerCase();
  return AA_ALIASES[normalised] ?? normalised;
}

/**
 * Newest capture per (model, metric). Keyed by the normalised id so AA's dated
 * aliases (`claude-haiku-4-5-20251001`) land on the route's bare id without a
 * hand-written entry for every date.
 */
export function buildAaLookup(rows: AaMetricRow[]): AaLookup {
  const lookup: AaLookup = new Map();
  const seenAt = new Map<string, string>();
  for (const row of rows) {
    if (row.metric !== "quality" && row.metric !== "coding_index") continue;
    const key = normaliseModelId(row.model_id).toLowerCase();
    const stamp = `${key} ${row.metric}`;
    const previous = seenAt.get(stamp);
    if (previous !== undefined && previous >= row.captured_at) continue;
    seenAt.set(stamp, row.captured_at);

    const entry = lookup.get(key) ?? {
      intelligence: null,
      coding: null,
      capturedAt: null,
      sourceId: row.model_id,
      approximate: false,
    };
    if (row.metric === "quality") entry.intelligence = row.value;
    else entry.coding = row.value;
    entry.sourceId = row.model_id;
    if (entry.capturedAt === null || row.captured_at > entry.capturedAt) {
      entry.capturedAt = row.captured_at;
    }
    lookup.set(key, entry);
  }
  return lookup;
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

/** AA's numbers for a route id, or null when the leaderboard has never rated
 *  it. An aliased hit is flagged `approximate` rather than passed off as exact. */
export function lookupAa(modelId: string, lookup: AaLookup): AaIndex | null {
  const key = aaKey(modelId);
  const hit = lookup.get(key);
  if (!hit) return null;
  const approximate = key !== normaliseModelId(modelId).toLowerCase();
  return approximate ? { ...hit, approximate: true } : hit;
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

/** The subset of `pick_probe` this needs — a real row satisfies it. */
export interface RateProbeRow {
  model_id: string;
  price_in_per_m: number | null;
  price_out_per_m: number | null;
  context_window: number | null;
  context_window_exact: boolean;
  notes: string | null;
}

const EMPTY_RATE_CARD: RateCard = {
  inPerM: null,
  outPerM: null,
  contextWindow: null,
  contextWindowExact: false,
  notes: [],
  basis: null,
};

export function buildRateCards(rows: RateProbeRow[]): Map<string, RateCard> {
  return new Map(
    rows.map((row) => [
      row.model_id,
      {
        inPerM: row.price_in_per_m,
        outPerM: row.price_out_per_m,
        contextWindow: row.context_window,
        contextWindowExact: row.context_window_exact,
        notes: row.notes ? row.notes.split(" | ") : [],
        basis: "measured" as const,
      },
    ]),
  );
}

/** Claude ids take the committed list card (the CLI prices them correctly);
 *  everything else takes whatever `pick_probe` solved. Same precedence as
 *  `resolveRates` in cost.ts, so the table and the cost column never disagree. */
export function rateCardFor(modelId: string, probed: Map<string, RateCard>): RateCard {
  const claude = CLAUDE_LIST_RATES[normaliseModelId(modelId)];
  if (claude) {
    return {
      inPerM: claude.inPerM,
      outPerM: claude.outPerM,
      contextWindow: CLAUDE_CONTEXT_WINDOW[normaliseModelId(modelId)] ?? null,
      contextWindowExact: true,
      notes: [],
      basis: "list",
    };
  }
  return probed.get(modelId) ?? EMPTY_RATE_CARD;
}

// ── the shape ────────────────────────────────────────────────────────────────

export interface BenchModelRow {
  modelId: string;
  /** 0 when the model never produced a graded run in this suite. */
  composite: number;
  quality: number;
  passRate: number;
  totalCostUsd: number | null;
  costBasis: BasisLabel;
  totalDurationMs: number;
  meanTurns: number | null;
  /** Mean time-to-first-token across this model's runs, ms. Null when no run
   *  reported one — never rendered as zero or as fast. */
  meanTtftMs: number | null;
  toolErrorRate: number;
  runCount: number;
  taskCount: number;
  /** Runs the harness killed for exceeding the task budget. A timeout is a
   *  latency result, not a quality one — `glm-5.3-flash` scored 1.00 on
   *  `parser-spec` *while* timing out, and went 4/4 at 1.00 when re-run at a 4x
   *  budget. Counted separately so the two never get confused again. */
  timeoutRuns: number;
  /** Mean score over the runs that were not clock-limited. Equal to `quality`
   *  when nothing timed out. This is what the worker pick reads, because an
   *  unattended job can afford to be slow; the interactive pick reads `quality`,
   *  where being killed on the clock is a real failure. */
  qualityExcludingTimeouts: number;
  aa: AaIndex | null;
  rate: RateCard;
  residency: RouteResidency;
  dead: boolean;
  incompatible: boolean;
  /** False when the row carries no measurement at all — a documented dead end
   *  listed for completeness rather than a model this suite ran. */
  measured: boolean;
  /** False when the row must never win a pick: dead, Claude-Code-incompatible,
   *  or it produced no graded task. */
  eligible: boolean;
}

/** One cell of the model x task matrix. `failures` is what separates "scored
 *  low" from "died" — different findings that must not render the same. */
export interface BenchTaskCell {
  modelId: string;
  taskId: string;
  attempts: number;
  score: number;
  passed: boolean;
  failures: BenchFailure[];
}

export type PickRole = "interactive" | "worker" | "eu";

export interface BenchPick {
  role: PickRole;
  modelId: string;
  /** One clause naming the measurement that decided it. */
  why: string;
}

export interface BenchPicks {
  interactive: BenchPick | null;
  worker: BenchPick | null;
  eu: BenchPick | null;
}

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

export interface SuiteInfo {
  suiteId: string;
  modelCount: number;
  taskCount: number;
  runCount: number;
  latestAt: string;
}

export interface BenchSummary {
  /** Empty string when there was no suite to summarise. */
  suiteId: string;
  /** Newest first — what a suite selector offers. */
  suites: SuiteInfo[];
  /** Latest `created_at` across this suite's runs. */
  capturedAt: string | null;
  /** Task ids in the order the suite ran them. */
  taskIds: string[];
  /** Every row, ranked by composite descending, screened-out ids last. */
  models: BenchModelRow[];
  cells: BenchTaskCell[];
  picks: BenchPicks;
  caveats: BenchCaveats;
}

export interface SummaryInput {
  suiteId: string;
  runs: BenchRunResult[];
  aaRows: AaMetricRow[];
  probes: RateProbeRow[];
  suites?: SuiteInfo[];
  capturedAt?: string | null;
}

// ── derivation ───────────────────────────────────────────────────────────────

function basisByModel(runs: BenchRunResult[]): Map<string, BasisLabel> {
  const seen = new Map<string, Set<CostBasis>>();
  for (const run of runs) {
    const bucket = seen.get(run.modelId);
    if (bucket) bucket.add(run.costBasis);
    else seen.set(run.modelId, new Set([run.costBasis]));
  }
  const out = new Map<string, BasisLabel>();
  for (const [modelId, bases] of seen) {
    const only = bases.size === 1 ? [...bases][0] : null;
    out.set(modelId, only ?? "mixed");
  }
  return out;
}

/** Task ids in first-seen order. The stored rows are in insertion order, which
 *  is the order the suite ran them — core tier before hard tier — and that
 *  reads better than alphabetical without needing the task registry here. */
function orderedTaskIds(runs: BenchRunResult[]): string[] {
  const seen: string[] = [];
  for (const run of runs) {
    if (!seen.includes(run.taskId)) seen.push(run.taskId);
  }
  return seen;
}

/** Documented dead ends that this suite never ran, carried as measurement-free
 *  rows so `--all` can show why an id is missing instead of leaving a hole. */
function screenedOutRows(
  present: Set<string>,
  probed: Map<string, RateCard>,
  aaLookup: AaLookup,
): BenchModelRow[] {
  const ids = [...new Set([...DEAD_IDS, ...CLAUDE_CODE_INCOMPATIBLE])].filter(
    (id) => !present.has(id),
  );
  return ids.map((modelId) => ({
    modelId,
    composite: 0,
    quality: 0,
    passRate: 0,
    totalCostUsd: null,
    costBasis: "unpriced" as const,
    totalDurationMs: 0,
    meanTurns: null,
    meanTtftMs: null,
    toolErrorRate: 0,
    runCount: 0,
    taskCount: 0,
    timeoutRuns: 0,
    qualityExcludingTimeouts: 0,
    aa: lookupAa(modelId, aaLookup),
    rate: rateCardFor(modelId, probed),
    residency: routeResidencyOf(modelId),
    dead: isDeadModel(modelId),
    incompatible: isClaudeCodeIncompatible(modelId),
    measured: false,
    eligible: false,
  }));
}

/** Per model: how many runs the clock killed, and the mean score over the rest. */
function clockStats(runs: BenchRunResult[]): Map<string, { timeouts: number; quality: number }> {
  const acc = new Map<string, { timeouts: number; sum: number; n: number }>();
  for (const run of runs) {
    const entry = acc.get(run.modelId) ?? { timeouts: 0, sum: 0, n: 0 };
    if (run.metrics.failure === "timeout") entry.timeouts++;
    else {
      entry.sum += run.grade.score;
      entry.n++;
    }
    acc.set(run.modelId, entry);
  }
  return new Map(
    [...acc].map(([modelId, e]) => [
      modelId,
      { timeouts: e.timeouts, quality: e.n === 0 ? 0 : e.sum / e.n },
    ]),
  );
}

export function buildBenchSummary(input: SummaryInput): BenchSummary {
  const summaries = perModel(input.runs, []);
  const composites = composite(summaries);
  const summaryById = new Map(summaries.map((s) => [s.modelId, s]));
  const bases = basisByModel(input.runs);
  const aaLookup = buildAaLookup(input.aaRows);
  const probed = buildRateCards(input.probes);
  const clock = clockStats(input.runs);

  const measured: BenchModelRow[] = composites.map((entry) => {
    const summary = summaryById.get(entry.modelId);
    const dead = isDeadModel(entry.modelId);
    const incompatible = isClaudeCodeIncompatible(entry.modelId);
    const taskCount = summary?.taskCount ?? 0;
    return {
      modelId: entry.modelId,
      composite: entry.composite,
      quality: entry.quality,
      passRate: summary?.passRate ?? 0,
      totalCostUsd: summary?.totalCostUsd ?? null,
      costBasis: bases.get(entry.modelId) ?? "unpriced",
      totalDurationMs: summary?.totalDurationMs ?? 0,
      meanTurns: summary && summary.runCount > 0 ? summary.totalTurns / summary.runCount : null,
      meanTtftMs: summary?.meanTtftMs ?? null,
      toolErrorRate: summary?.toolErrorRate ?? 0,
      runCount: summary?.runCount ?? 0,
      taskCount,
      timeoutRuns: clock.get(entry.modelId)?.timeouts ?? 0,
      qualityExcludingTimeouts: clock.get(entry.modelId)?.quality ?? entry.quality,
      aa: lookupAa(entry.modelId, aaLookup),
      rate: rateCardFor(entry.modelId, probed),
      residency: routeResidencyOf(entry.modelId),
      dead,
      incompatible,
      measured: true,
      eligible: !dead && !incompatible && taskCount > 0,
    };
  });

  const present = new Set(measured.map((row) => row.modelId));
  const models = [...measured, ...screenedOutRows(present, probed, aaLookup)];

  return {
    suiteId: input.suiteId,
    suites: input.suites ?? [],
    capturedAt: input.capturedAt ?? null,
    taskIds: orderedTaskIds(input.runs),
    models,
    cells: perTask(input.runs).map((row: PerTaskScore) => ({
      modelId: row.modelId,
      taskId: row.taskId,
      attempts: row.attempts,
      score: row.score,
      passed: row.passed,
      failures: row.failures,
    })),
    picks: derivePicks(models),
    caveats: deriveCaveats(models),
  };
}

/** Sorts a copy and takes the head — the comparators below all express "best
 *  first", so a pick is always the first survivor of its own filter. */
function best(rows: BenchModelRow[], compare: (a: BenchModelRow, b: BenchModelRow) => number) {
  return rows.length === 0 ? null : (rows.toSorted(compare)[0] ?? null);
}

function byId(a: BenchModelRow, b: BenchModelRow): number {
  return a.modelId.localeCompare(b.modelId);
}

/** Null sorts last: a model nobody priced must never win a "cheapest" contest. */
function byCostAsc(a: BenchModelRow, b: BenchModelRow): number {
  if (a.totalCostUsd === null && b.totalCostUsd === null) return 0;
  if (a.totalCostUsd === null) return 1;
  if (b.totalCostUsd === null) return -1;
  return a.totalCostUsd - b.totalCostUsd;
}

function byAaDesc(a: BenchModelRow, b: BenchModelRow): number {
  return (aaIntelligenceOf(b) ?? -1) - (aaIntelligenceOf(a) ?? -1);
}

/**
 * The three picks, exactly as the decision doc argues them:
 *
 *  - **interactive** — fastest of the models that scored a flat 1.00. Wall clock
 *    is the product when a human is waiting; composite breaks a tie.
 *  - **worker** — cheapest of the same perfect set, tie-broken by the external
 *    intelligence index, because nobody is watching and the two are otherwise
 *    indistinguishable here.
 *  - **eu** — cheapest id the route survey marks EU-resident, falling back to
 *    the documented `claude-opus-5` only when it is actually in the field.
 *
 * Dead, Claude-Code-incompatible and ungraded rows are excluded from all three.
 * A role with no candidate returns null: a field this cannot rank is a thing to
 * say out loud, not to paper over with the least-bad row.
 */
export function derivePicks(models: BenchModelRow[]): BenchPicks {
  const field = models.filter((row) => row.eligible);
  const perfect = field.filter((row) => row.quality >= PERFECT);

  const fastest = best(
    perfect,
    (a, b) => a.totalDurationMs - b.totalDurationMs || b.composite - a.composite || byId(a, b),
  );
  // The worker pick tolerates a clock-limited run where the interactive pick
  // cannot: an unattended job may take forty minutes, a waiting human may not.
  // Measured: `glm-5.3-flash` lost 0.03 of `quality` to two timeouts and went
  // 4/4 at 1.00 when re-run at a 4x budget, so excluding those runs is reading
  // the evidence rather than forgiving a failure.
  const workerPerfect = field.filter((row) => row.qualityExcludingTimeouts >= PERFECT);
  const cheapest = best(
    workerPerfect.filter((row) => row.totalCostUsd !== null),
    (a, b) => byCostAsc(a, b) || byAaDesc(a, b) || byId(a, b),
  );
  const euResident = best(
    field.filter((row) => row.residency === "eu"),
    (a, b) => byCostAsc(a, b) || b.composite - a.composite || byId(a, b),
  );
  const euFallback = euResident ?? field.find((row) => row.modelId === EU_FALLBACK_ID) ?? null;

  return {
    interactive:
      fastest === null
        ? null
        : {
            role: "interactive",
            modelId: fastest.modelId,
            why: `fastest of the ${perfect.length} model(s) that scored a flat 1.00 — ${formatDuration(fastest.totalDurationMs)} over ${fastest.taskCount} task(s)`,
          },
    worker:
      cheapest === null
        ? null
        : {
            role: "worker",
            modelId: cheapest.modelId,
            why: `cheapest perfect score at ${formatUsd(cheapest.totalCostUsd)}${
              aaIntelligenceOf(cheapest) === null
                ? ""
                : `, AA intelligence ${(aaIntelligenceOf(cheapest) ?? 0).toFixed(1)}`
            } — ${formatDuration(cheapest.totalDurationMs)} wall, which is what the price buys${
              cheapest.timeoutRuns > 0
                ? `; ${cheapest.timeoutRuns} run(s) exceeded the task budget and are excluded as latency, not quality`
                : ""
            }`,
          },
    eu:
      euFallback === null
        ? null
        : {
            role: "eu",
            modelId: euFallback.modelId,
            why:
              euResident === null
                ? `nothing in the field surveys as EU-resident — falling back to the documented ${EU_FALLBACK_ID}`
                : `cheapest EU-resident id on the route at ${formatUsd(euFallback.totalCostUsd)}`,
          },
  };
}

export function deriveCaveats(models: BenchModelRow[]): BenchCaveats {
  const field = models.filter((row) => row.eligible);
  const rated = field.filter((row) => aaIntelligenceOf(row) !== null);
  const byAa = rated.toSorted(
    (a, b) => (aaIntelligenceOf(a) ?? 0) - (aaIntelligenceOf(b) ?? 0) || byId(a, b),
  );
  const low = byAa[0];
  const high = byAa[byAa.length - 1];
  const lowValue = low === undefined ? null : aaIntelligenceOf(low);
  const highValue = high === undefined ? null : aaIntelligenceOf(high);

  const basisCounts: Record<BasisLabel, number> = { measured: 0, list: 0, unpriced: 0, mixed: 0 };
  const labels = new Set<BasisLabel>();
  for (const row of field) {
    labels.add(row.costBasis);
    basisCounts[row.costBasis] += 1;
  }
  const onlyLabel = labels.size === 1 ? [...labels][0] : null;

  return {
    perfectCount: field.filter((row) => row.quality >= PERFECT).length,
    scoredCount: field.length,
    aaSpread:
      byAa.length > 1 && lowValue !== null && highValue !== null && low && high
        ? {
            low: lowValue,
            lowModelId: low.modelId,
            high: highValue,
            highModelId: high.modelId,
          }
        : null,
    costBasis: onlyLabel ?? "mixed",
    basisCounts,
    requestyIds: field.filter((row) => !isClaudeModel(row.modelId)).map((row) => row.modelId),
  };
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

export const MISSING = "—";

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

// ── suite selection ──────────────────────────────────────────────────────────

/**
 * The suite to summarise: the requested one if it exists, else the newest that
 * ranked at least `minModels` models. Returns null rather than falling back to
 * a two-model spot-check — an empty page is honest, a retest suite dressed as a
 * leaderboard is not.
 */
export function chooseSuite(
  suites: SuiteInfo[],
  requested: string | null,
  minModels: number = MIN_SUITE_MODELS,
): SuiteInfo | null {
  if (requested !== null) return suites.find((s) => s.suiteId === requested) ?? null;
  const ranked = suites.filter((s) => s.modelCount >= minModels);
  return ranked[0] ?? null;
}

// ── stored rows → the scoring shape ──────────────────────────────────────────

/** Rehydrates one `bench_run` row into the shape `score.ts` consumes. The two
 *  columns the table does not store (`toolCallsByName`, `filesEdited`) come
 *  back empty; nothing downstream of here reads them. */
export function benchRunResultFromRow(row: BenchRun): BenchRunResult {
  return {
    suiteId: row.suite_id,
    modelId: row.model_id,
    taskId: row.task_id,
    attempt: row.attempt,
    startedAt: row.created_at,
    transcriptPath: row.transcript_path ?? "",
    costBasis: row.cost_basis,
    grade: {
      score: row.score,
      passed: row.passed,
      checks: JSON.parse(row.checks_json) as BenchCheck[],
    },
    metrics: {
      ok: row.ok,
      failure: row.failure,
      durationMs: row.duration_ms,
      apiDurationMs: row.api_duration_ms,
      ttftMs: row.ttft_ms,
      numTurns: row.num_turns,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      thinkingTokens: row.thinking_tokens,
      costUsd: row.cost_usd,
      toolCalls: row.tool_calls,
      toolCallsByName: {},
      toolErrors: row.tool_errors,
      parallelBatches: row.parallel_batches,
      maxParallelWidth: row.max_parallel_width,
      apiErrors: row.api_errors,
      terminalReason: row.terminal_reason,
      filesEdited: [],
      notes: row.notes ? row.notes.split(" | ") : [],
    },
  };
}

export function summariseSuites(
  rows: Pick<BenchRun, "suite_id" | "model_id" | "task_id" | "created_at">[],
): SuiteInfo[] {
  const grouped = new Map<
    string,
    { models: Set<string>; tasks: Set<string>; runs: number; latestAt: string }
  >();
  for (const row of rows) {
    const bucket = grouped.get(row.suite_id) ?? {
      models: new Set<string>(),
      tasks: new Set<string>(),
      runs: 0,
      latestAt: row.created_at,
    };
    bucket.models.add(row.model_id);
    bucket.tasks.add(row.task_id);
    bucket.runs += 1;
    if (row.created_at > bucket.latestAt) bucket.latestAt = row.created_at;
    grouped.set(row.suite_id, bucket);
  }
  return [...grouped.entries()]
    .map(([suiteId, bucket]) => ({
      suiteId,
      modelCount: bucket.models.size,
      taskCount: bucket.tasks.size,
      runCount: bucket.runs,
      latestAt: bucket.latestAt,
    }))
    .toSorted((a, b) =>
      a.latestAt === b.latestAt
        ? a.suiteId.localeCompare(b.suiteId)
        : b.latestAt.localeCompare(a.latestAt),
    );
}

// ── the adapter ──────────────────────────────────────────────────────────────

export interface LoadSummaryOptions {
  /** Suite id to render; null takes the newest suite that ranked a field. */
  suiteId?: string | null;
}

/**
 * Reads `modelpick.db` and derives everything. Costs nothing and calls nothing
 * — that is the contract `cap` depends on, so it can answer "which model" with
 * no key, no network and no spend.
 */
export async function loadBenchSummary(options: LoadSummaryOptions = {}): Promise<BenchSummary> {
  const [indexRows, aaRows, probes] = await Promise.all([
    db
      .select({
        suite_id: benchRun.suite_id,
        model_id: benchRun.model_id,
        task_id: benchRun.task_id,
        created_at: benchRun.created_at,
      })
      .from(benchRun),
    db.select().from(metricSnapshot).orderBy(desc(metricSnapshot.captured_at)),
    db.select().from(pickProbe),
  ]);

  const suites = summariseSuites(indexRows);
  const chosen = chooseSuite(suites, options.suiteId ?? null);
  const empty: SummaryInput = {
    suiteId: chosen?.suiteId ?? "",
    runs: [],
    aaRows: aaRows.filter((row) => row.source === "artificialanalysis"),
    probes,
    suites,
    capturedAt: chosen?.latestAt ?? null,
  };
  if (chosen === null) return buildBenchSummary(empty);

  // Ordered by primary key, i.e. insertion order — that is what makes the task
  // columns come out in the order the suite ran them.
  const rows = (await db.select().from(benchRun).orderBy(benchRun.id)).filter(
    (row) => row.suite_id === chosen.suiteId,
  );

  return buildBenchSummary({ ...empty, runs: rows.map(benchRunResultFromRow) });
}
