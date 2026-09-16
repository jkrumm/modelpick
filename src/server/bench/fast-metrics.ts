/**
 * bench-fast's pure measurement pipeline — usage-token inference and per-cell
 * median aggregation. No fetch, no SSE, no DB, no clock: every function here
 * takes call records in and returns numbers out, so the medians, the decode-
 * rate threshold, and the reasoning-token inference are all unit-testable
 * without a live stream. scripts/bench-fast.ts is the thin orchestrator that
 * drives real HTTP calls and hands their results to `summarizeCell`.
 */

export type EffortLevel = "default" | "none" | "low" | "medium" | "high";
export const ALL_EFFORTS: readonly EffortLevel[] = ["default", "none", "low", "medium", "high"];

// ── usage-token inference ────────────────────────────────────────────────────

export interface UsageInput {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** `completion_tokens_details.reasoning_tokens` as reported by the route,
   *  0 when absent. */
  reportedReasoningTokens: number;
  /** The text actually assembled from `delta.content` frames during the
   *  stream — the ground truth for "how much did the model actually show",
   *  independent of what the usage object claims. */
  streamedText: string;
}

export interface InferredUsage {
  visibleTokens: number;
  reasoningTokens: number;
  reportedReasoningTokens: number;
}

/**
 * Same two-shape correction benchmark-bakeoff.ts documents at length
 * (`completion_tokens` already includes reasoning on Azure/Requesty ids;
 * Gemini-on-OpenAI-compat excludes it from `completion_tokens` and only
 * `total_tokens` counts it) — plus the fallback that shape alone misses. Some
 * routes report `reasoning_tokens: 0` on a call that is provably still
 * thinking (deepseek-v4.1-flash observed live, 2026-09-12: a one-word prompt
 * billing 22 completion tokens for a handful of visible words). When the
 * route's own reasoning figure is 0, infer it from the gap between
 * `completion_tokens` and what the stream actually delivered as visible
 * content, in addition to the total-tokens-hides-thinking case the original
 * shape already covered — take whichever inference is larger, since either
 * shape can apply depending on the route.
 */
export function inferUsage(input: UsageInput): InferredUsage {
  const { promptTokens, completionTokens, totalTokens, reportedReasoningTokens, streamedText } =
    input;
  const streamedVisibleEstimate = Math.round(streamedText.length / 4);
  const inferredFromCompletion = Math.max(0, completionTokens - streamedVisibleEstimate);
  const hiddenFromTotal = Math.max(0, totalTokens - promptTokens - completionTokens);
  const reasoningTokens =
    reportedReasoningTokens > 0
      ? reportedReasoningTokens
      : Math.max(inferredFromCompletion, hiddenFromTotal);
  const billedOutput = Math.max(completionTokens, totalTokens - promptTokens);
  const visibleTokens = Math.max(0, billedOutput - reasoningTokens);
  return { visibleTokens, reasoningTokens, reportedReasoningTokens };
}

// ── call classification ──────────────────────────────────────────────────────

export type OutcomeKind = "pass" | "fail" | "starved";

/**
 * A call that hit its token cap (`finish_reason === "length"`) and produced
 * zero visible tokens spent its whole budget on hidden reasoning — that is a
 * budget failure, not a wrong answer, and must never be graded the same way.
 * docs/decisions/hermes-brain.md already records this trap for Gemini at a
 * 500-token cap; the same shape applies to any thinking model at any cap.
 */
export function classifyOutcome(
  finishReason: string | null,
  visibleTokens: number,
  passed: boolean,
): OutcomeKind {
  if (finishReason === "length" && visibleTokens === 0) return "starved";
  return passed ? "pass" : "fail";
}

// ── per-call record ───────────────────────────────────────────────────────────

export interface CallRow {
  taskId: string;
  repeat: number;
  ttfbMs: number | null;
  ttftMs: number | null;
  thinkMs: number;
  wallMs: number;
  visibleTokens: number;
  reasoningTokens: number;
  /** The raw `completion_tokens_details.reasoning_tokens` the route reported,
   *  before any inference — `reasoningLooksConstant` reads this directly. */
  reportedReasoningTokens: number;
  finishReason: string | null;
  outcomeKind: OutcomeKind;
  costUsd: number | null;
  /** True only for a real API response with a parsed usage object — false for
   *  a network error, a timeout, or anything that never reached the model. */
  hasUsage: boolean;
}

export interface CellResult {
  model: string;
  effort: EffortLevel;
  supported: boolean;
  rows: CallRow[];
}

// ── aggregation helpers ──────────────────────────────────────────────────────

/** A row's timing is only trustworthy once both `ttfb` and `ttft` fired — a
 *  call that produced no visible content (an error, a timeout, or a starved
 *  reasoning-only response) has `ttftMs === null` and must never enter a
 *  median alongside rows that do, or wall can compute lower than ttft even
 *  though wall >= ttft holds for every individual call. */
export function isCompleteRow(row: CallRow): boolean {
  return row.ttfbMs !== null && row.ttftMs !== null;
}

/** A decode rate computed over a dozen visible tokens is dominated by
 *  scheduling noise, not the model's real throughput — only a call whose
 *  answer is long enough (in practice, only `longform`) produces a usable
 *  rate. */
export const MIN_DECODE_VISIBLE_TOKENS = 200;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function groupByTask(rows: CallRow[]): Map<string, CallRow[]> {
  const map = new Map<string, CallRow[]>();
  for (const row of rows) {
    const list = map.get(row.taskId) ?? [];
    list.push(row);
    map.set(row.taskId, list);
  }
  return map;
}

/**
 * A model whose reported `reasoning_tokens` value never changes across a
 * spread of efforts and (crucially) across tasks with very different token
 * budgets is not reporting a measurement — a real reasoning-token count would
 * track the task's `max_completion_tokens`, not sit at one fixed integer for
 * a 20-token classify answer and a 4000-token longform one alike. Requires at
 * least 3 nonzero samples across at least 2 distinct tasks before flagging,
 * so a genuinely small, stable field never trips this on thin data.
 */
export function reasoningLooksConstant(rows: CallRow[]): boolean {
  const reported = rows.filter((r) => r.hasUsage && r.reportedReasoningTokens > 0);
  if (reported.length < 3) return false;
  const distinctTasks = new Set(reported.map((r) => r.taskId));
  if (distinctTasks.size < 2) return false;
  return new Set(reported.map((r) => r.reportedReasoningTokens)).size === 1;
}

// ── cell summary ──────────────────────────────────────────────────────────────

export interface CellSummary {
  model: string;
  effort: EffortLevel;
  supported: boolean;
  /** Every call attempted in this cell (repeats x tasks), including starved
   *  and errored ones. Null for an unsupported cell — no calls were made. */
  attemptedCalls: number | null;
  /** `attemptedCalls` minus `starvedCalls` — the pass-rate denominator. */
  gradedCalls: number | null;
  passedCalls: number | null;
  starvedCalls: number | null;
  /** True when starved calls are the majority of the cell — the headline
   *  reports `starved` instead of a pass fraction in that case. */
  majorityStarved: boolean;
  /** Tasks where a majority of their non-starved repeats passed, out of
   *  `taskCount` — the 4/4-style headline column. */
  taskPassCount: number | null;
  taskCount: number;
  /** Rows with complete timing (used for every median below) vs. every row
   *  attempted — the dropped-row count that makes a mostly-incomplete cell
   *  visible instead of silently plausible. */
  timingRows: number;
  timingRowsTotal: number;
  medianWallMs: number | null;
  medianTtfbMs: number | null;
  medianTtftMs: number | null;
  medianThinkMs: number | null;
  medianVisibleTokens: number | null;
  medianReasoningTokens: number | null;
  /** Median total completion tokens (visible + reasoning) per call, over
   *  every call with a usage reading — including starved ones, since "how
   *  much it thought before giving up" is exactly what a starved call shows. */
  medianCompletionTokens: number | null;
  /** max - min reasoning tokens across the cell's usage-bearing calls — the
   *  "does its thinking expand to fill whatever budget it's given" signal. */
  thinkingSpread: number | null;
  decodeTokPerSec: number | null;
  thinkVisibleRatio: number | null;
  /** Cost of one full pass over every task, summed from each task's own
   *  median cost across its repeats — see `costNote` for why it can be null. */
  costPerRun: number | null;
  /** `no-rate`: the model has no price_in/price_out in metric_snapshot at
   *  all. `unpriced`: a rate exists but every call in the cell failed to
   *  price. `partial`: at least one task priced and at least one did not —
   *  `costPerRun` is a real but undercounted sum. `priced`: every task
   *  contributed a price. */
  costNote: "priced" | "partial" | "unpriced" | "no-rate";
  /** Median visible-token count per task, keyed by task id, from timing-
   *  complete rows only — the crossover section reads `longform`'s entry off
   *  this rather than the cell-wide median. */
  taskMedianVisibleTokens: Record<string, number | null>;
}

function emptyCellSummary(model: string, effort: EffortLevel, taskCount: number): CellSummary {
  return {
    model,
    effort,
    supported: false,
    attemptedCalls: null,
    gradedCalls: null,
    passedCalls: null,
    starvedCalls: null,
    majorityStarved: false,
    taskPassCount: null,
    taskCount,
    timingRows: 0,
    timingRowsTotal: 0,
    medianWallMs: null,
    medianTtfbMs: null,
    medianTtftMs: null,
    medianThinkMs: null,
    medianVisibleTokens: null,
    medianReasoningTokens: null,
    medianCompletionTokens: null,
    thinkingSpread: null,
    decodeTokPerSec: null,
    thinkVisibleRatio: null,
    costPerRun: null,
    costNote: "no-rate",
    taskMedianVisibleTokens: {},
  };
}

/** `hasRate` is whether the model has a price card at all — folded in from
 *  outside since a `CellResult` has no rate-card context of its own. */
export function summarizeCell(
  result: CellResult,
  taskCount: number,
  hasRate: boolean,
): CellSummary {
  if (!result.supported || result.rows.length === 0) {
    return emptyCellSummary(result.model, result.effort, taskCount);
  }
  const { rows } = result;
  const completeRows = rows.filter(isCompleteRow);

  const attemptedCalls = rows.length;
  const starvedCalls = rows.filter((r) => r.outcomeKind === "starved").length;
  const gradedRows = rows.filter((r) => r.outcomeKind !== "starved");
  const gradedCalls = gradedRows.length;
  const passedCalls = rows.filter((r) => r.outcomeKind === "pass").length;
  const majorityStarved = starvedCalls * 2 > attemptedCalls;

  let taskPassCount = 0;
  for (const taskRows of groupByTask(gradedRows).values()) {
    if (taskRows.length === 0) continue;
    const majorityPassed =
      taskRows.filter((r) => r.outcomeKind === "pass").length * 2 > taskRows.length;
    if (majorityPassed) taskPassCount++;
  }

  // Cost is keyed on every attempted row, grouped per task, so one failed
  // repeat never blanks a task that priced fine on its other repeats.
  let costPerRun = 0;
  let anyTaskPriced = false;
  let anyTaskUnpriced = false;
  for (const taskRows of groupByTask(rows).values()) {
    const costs = taskRows.map((r) => r.costUsd).filter((c): c is number => c !== null);
    if (costs.length > 0) {
      costPerRun += median(costs) ?? 0;
      anyTaskPriced = true;
    } else {
      anyTaskUnpriced = true;
    }
  }
  const costNote: CellSummary["costNote"] = !hasRate
    ? "no-rate"
    : !anyTaskPriced
      ? "unpriced"
      : anyTaskUnpriced
        ? "partial"
        : "priced";
  const costPerRunFinal = hasRate && anyTaskPriced ? costPerRun : null;

  // Timing medians: complete rows only — see `isCompleteRow`.
  const medianWallMs = median(completeRows.map((r) => r.wallMs));
  const medianTtfbMs = median(completeRows.map((r) => r.ttfbMs as number));
  const medianTtftMs = median(completeRows.map((r) => r.ttftMs as number));
  const medianThinkMs = median(completeRows.map((r) => r.thinkMs));
  const medianVisible = median(completeRows.map((r) => r.visibleTokens));
  const medianReasoning = median(completeRows.map((r) => r.reasoningTokens));

  const decodeEligible = completeRows.filter(
    (r) => r.visibleTokens >= MIN_DECODE_VISIBLE_TOKENS && r.wallMs - (r.ttftMs as number) > 0,
  );
  const decodeTokPerSec = median(
    decodeEligible.map((r) => r.visibleTokens / ((r.wallMs - (r.ttftMs as number)) / 1000)),
  );

  const usageRows = rows.filter((r) => r.hasUsage);
  const medianCompletionTokens = median(usageRows.map((r) => r.visibleTokens + r.reasoningTokens));
  const reasoningValues = usageRows.map((r) => r.reasoningTokens);
  const thinkingSpread =
    reasoningValues.length >= 2
      ? Math.max(...reasoningValues) - Math.min(...reasoningValues)
      : null;

  const taskMedianVisibleTokens: Record<string, number | null> = {};
  for (const [taskId, taskRows] of groupByTask(completeRows)) {
    taskMedianVisibleTokens[taskId] = median(taskRows.map((r) => r.visibleTokens));
  }

  return {
    model: result.model,
    effort: result.effort,
    supported: true,
    attemptedCalls,
    gradedCalls,
    passedCalls,
    starvedCalls,
    majorityStarved,
    taskPassCount,
    taskCount,
    timingRows: completeRows.length,
    timingRowsTotal: rows.length,
    medianWallMs,
    medianTtfbMs,
    medianTtftMs,
    medianThinkMs,
    medianVisibleTokens: medianVisible,
    medianReasoningTokens: medianReasoning,
    medianCompletionTokens,
    thinkingSpread,
    decodeTokPerSec,
    thinkVisibleRatio:
      medianReasoning !== null && medianVisible !== null
        ? medianReasoning / Math.max(1, medianVisible)
        : null,
    costPerRun: costPerRunFinal,
    costNote,
    taskMedianVisibleTokens,
  };
}
