/**
 * decision-bench's pure measurement pipeline — per-call records in, per-model
 * summaries and a ranking out. No fetch, no DB, no clock, so the medians, the
 * error/refusal accounting and the ranking are unit-testable without a live
 * model. scripts/bench-decision.ts drives the calls; the /decision tab reads the
 * persisted metrics back through `rowFromMetrics` and ranks them with the same
 * `rankDecisionRows`, so the page and the report cannot disagree.
 *
 * Accounting rules (docs/GUIDELINES.md §3):
 *  - An errored call (HTTP failure, timeout, malformed envelope) is counted as an
 *    error, never as a wrong answer, and is excluded from every other number.
 *  - A refused question is its own outcome: out of the accuracy denominator,
 *    reported as a refusal rate.
 *  - Latency is a median, taken over the same non-error calls as the other columns.
 */
import type { QuestionGrade } from "./decision-tasks.js";

export interface DecisionCallRecord {
  model: string;
  task: string;
  caseId: string;
  repeat: number;
  wallMs: number;
  costUsd: number | null;
  /** True when `costUsd` was derived from the rate card because the wire reports none. */
  costEstimated: boolean;
  /** Non-null when the call failed; `grades` is then empty. */
  error: string | null;
  grades: QuestionGrade[];
}

export interface SuiteSummary {
  task: string;
  calls: number;
  errorCalls: number;
  /** Fraction of graded (correct + wrong) questions answered correctly. */
  accuracy: number | null;
}

export interface ModelSummary {
  model: string;
  calls: number;
  errorCalls: number;
  errorRate: number;
  /** Macro average of the suite accuracies, so a big suite does not outvote a small one. */
  accuracy: number | null;
  /** Mean Brier score over every graded question that carried probabilities. */
  brier: number | null;
  latencyP50Ms: number | null;
  /** Mean cost per non-error call, scaled to 1,000 calls. */
  costPer1kCallsUsd: number | null;
  costEstimated: boolean;
  refusalRate: number;
  /** (task, case) pairs whose graded outcome differed between repeats. */
  unstableCases: number;
  suites: SuiteSummary[];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function accuracyOf(grades: QuestionGrade[]): number | null {
  const graded = grades.filter((g) => g.outcome !== "refused");
  if (graded.length === 0) return null;
  return graded.filter((g) => g.outcome === "correct").length / graded.length;
}

function countUnstable(records: DecisionCallRecord[]): number {
  const outcomesByCase = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.error !== null) continue;
    const key = `${r.task}/${r.caseId}`;
    const signature = r.grades.map((g) => `${g.question}:${g.outcome}`).join("|");
    const seen = outcomesByCase.get(key) ?? new Set<string>();
    seen.add(signature);
    outcomesByCase.set(key, seen);
  }
  return [...outcomesByCase.values()].filter((s) => s.size > 1).length;
}

export function summarizeModel(model: string, records: DecisionCallRecord[]): ModelSummary {
  const rows = records.filter((r) => r.model === model);
  const ok = rows.filter((r) => r.error === null);
  const grades = ok.flatMap((r) => r.grades);

  const taskIds = [...new Set(rows.map((r) => r.task))];
  const suites = taskIds.map((task): SuiteSummary => {
    const suiteRows = rows.filter((r) => r.task === task);
    return {
      task,
      calls: suiteRows.length,
      errorCalls: suiteRows.filter((r) => r.error !== null).length,
      accuracy: accuracyOf(suiteRows.filter((r) => r.error === null).flatMap((r) => r.grades)),
    };
  });
  const suiteAccuracies = suites.flatMap((s) => (s.accuracy === null ? [] : [s.accuracy]));

  const costed = ok.filter((r) => r.costUsd !== null);
  const meanCost = mean(costed.map((r) => r.costUsd as number));

  return {
    model,
    calls: rows.length,
    errorCalls: rows.length - ok.length,
    errorRate: rows.length === 0 ? 0 : (rows.length - ok.length) / rows.length,
    accuracy: mean(suiteAccuracies),
    brier: mean(grades.flatMap((g) => (g.brier === null ? [] : [g.brier]))),
    latencyP50Ms: median(ok.map((r) => r.wallMs)),
    costPer1kCallsUsd: meanCost === null ? null : meanCost * 1000,
    costEstimated: costed.some((r) => r.costEstimated),
    refusalRate:
      grades.length === 0
        ? 0
        : grades.filter((g) => g.outcome === "refused").length / grades.length,
    unstableCases: countUnstable(ok),
    suites,
  };
}

// ── persisted metrics ────────────────────────────────────────────────────────

export const DECISION_METRIC = {
  accuracy: "decision_accuracy",
  brier: "decision_brier",
  latencyP50Ms: "decision_latency_p50_ms",
  costPer1kCallsUsd: "decision_cost_per_1k_calls_usd",
  errorRate: "decision_error_rate",
  refusalRate: "decision_refusal_rate",
} as const;

/** Per-suite accuracy is stored as `decision_accuracy:<suite id>`. */
export function suiteMetricName(task: string): string {
  return `${DECISION_METRIC.accuracy}:${task}`;
}

export interface MetricPoint {
  metric: string;
  value: number;
}

/** What one model's run persists to `metric_snapshot` (source `live`). Overall
 *  numbers are only meaningful over the full task set, so the caller passes
 *  `includeOverall: false` for a `--tasks` subset run and only the per-suite
 *  accuracies are written — a partial run must not overwrite the headline. */
export function metricsOf(summary: ModelSummary, includeOverall: boolean): MetricPoint[] {
  const points: MetricPoint[] = [];
  const push = (metric: string, value: number | null): void => {
    if (value !== null) points.push({ metric, value });
  };
  for (const suite of summary.suites) push(suiteMetricName(suite.task), suite.accuracy);
  if (!includeOverall) return points;
  push(DECISION_METRIC.accuracy, summary.accuracy);
  push(DECISION_METRIC.brier, summary.brier);
  push(DECISION_METRIC.latencyP50Ms, summary.latencyP50Ms);
  push(DECISION_METRIC.costPer1kCallsUsd, summary.costPer1kCallsUsd);
  push(DECISION_METRIC.errorRate, summary.errorRate);
  push(DECISION_METRIC.refusalRate, summary.refusalRate);
  return points;
}

// ── ranking ──────────────────────────────────────────────────────────────────

export interface DecisionRow {
  model: string;
  accuracy: number | null;
  brier: number | null;
  latencyP50Ms: number | null;
  costPer1kCallsUsd: number | null;
  errorRate: number | null;
  refusalRate: number | null;
  suiteAccuracy: Record<string, number>;
}

/** Rebuilds a row from the latest persisted value per metric name. */
export function rowFromMetrics(model: string, metrics: ReadonlyMap<string, number>): DecisionRow {
  const suitePrefix = `${DECISION_METRIC.accuracy}:`;
  const suiteAccuracy: Record<string, number> = {};
  for (const [name, value] of metrics) {
    if (name.startsWith(suitePrefix)) suiteAccuracy[name.slice(suitePrefix.length)] = value;
  }
  return {
    model,
    accuracy: metrics.get(DECISION_METRIC.accuracy) ?? null,
    brier: metrics.get(DECISION_METRIC.brier) ?? null,
    latencyP50Ms: metrics.get(DECISION_METRIC.latencyP50Ms) ?? null,
    costPer1kCallsUsd: metrics.get(DECISION_METRIC.costPer1kCallsUsd) ?? null,
    errorRate: metrics.get(DECISION_METRIC.errorRate) ?? null,
    refusalRate: metrics.get(DECISION_METRIC.refusalRate) ?? null,
    suiteAccuracy,
  };
}

/** A model that fails more than this share of its calls is unusable as a lane
 *  regardless of how well it answers the calls that do succeed. */
export const UNRELIABLE_ERROR_RATE = 0.1;

export function isUnreliable(row: Pick<DecisionRow, "errorRate">): boolean {
  return (row.errorRate ?? 0) > UNRELIABLE_ERROR_RATE;
}

function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/** Reliable models first; then accuracy (high), calibration (low Brier), median
 *  latency (low). Accuracy ties are the norm on a saturated suite, which is why
 *  calibration and latency are real tiebreaks here and not decoration. */
export function rankDecisionRows<
  Row extends Pick<DecisionRow, "accuracy" | "brier" | "latencyP50Ms" | "errorRate">,
>(rows: Row[]): Row[] {
  return rows.toSorted(
    (a, b) =>
      Number(isUnreliable(a)) - Number(isUnreliable(b)) ||
      nullsLast(a.accuracy, b.accuracy, -1) ||
      nullsLast(a.brier, b.brier, 1) ||
      nullsLast(a.latencyP50Ms, b.latencyP50Ms, 1),
  );
}
