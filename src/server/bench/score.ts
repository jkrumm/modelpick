/**
 * Turns raw ccbench runs into the two numbers a decision actually needs: how
 * good a model is at driving the loop, and what that costs.
 *
 * Pure functions over `BenchRunResult[]` - no DB, no fs, no clock. Every
 * aggregate here is re-derivable from the stored rows, which is the point: a
 * scoring change must be replayable against old suites without re-spending.
 */
import {
  BENCH_DIMENSION,
  type BenchDimension,
  type BenchFailure,
  type BenchRunResult,
} from "./types.js";

/** Composite weights. Quality dominates by design - a cheap model that cannot
 *  finish the task is not a cheap model, it is a broken one. */
export const COMPOSITE_WEIGHTS = {
  quality: 0.5,
  cost: 0.2,
  speed: 0.2,
  toolFidelity: 0.1,
} as const;

export interface TaskDefinition {
  id: string;
  measures: BenchDimension[];
}

export interface PerTaskScore {
  modelId: string;
  taskId: string;
  attempts: number;
  /** Mean score across attempts of this (model, task) pair. */
  score: number;
  /** True only when every attempt passed - a flaky pass is not a pass. */
  passed: boolean;
  failures: BenchFailure[];
}

export interface ModelSummary {
  modelId: string;
  taskCount: number;
  runCount: number;
  /** Mean per-task score, 0..1. */
  quality: number;
  /** Share of tasks that passed every attempt, 0..1. */
  passRate: number;
  /** Mean score restricted to tasks that claim to measure the dimension. Null
   *  when no task in the suite measures it. */
  dimensions: Record<BenchDimension, number | null>;
  /** Summed run cost, on whichever basis each run carried (see cost.ts) - NOT
   *  an IU invoice. Null when no run in the model's set was priced at all;
   *  unpriced runs contribute nothing rather than a zero, so "we don't know"
   *  never reads as "it was free". */
  totalCostUsd: number | null;
  totalDurationMs: number;
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalThinkingTokens: number;
  totalToolCalls: number;
  totalToolErrors: number;
  /** toolErrors / toolCalls; 0 when the model never called a tool. */
  toolErrorRate: number;
  /** Share of tasks where the model batched at least two tool calls. */
  parallelism: number;
  /** Null rather than Infinity when nothing passed - a division nobody can act on. */
  costPerPassedTask: number | null;
  meanTtftMs: number | null;
  failures: Partial<Record<BenchFailure, number>>;
}

export interface CompositeScore {
  modelId: string;
  composite: number;
  quality: number;
  /** best/value, clamped - the cheapest model scores 1.0. */
  costTerm: number;
  /** best/value, clamped - the fastest model scores 1.0. */
  speedTerm: number;
  toolFidelityTerm: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** One row per (model, task), collapsing repeats. */
export function perTask(results: BenchRunResult[]): PerTaskScore[] {
  const byKey = new Map<string, BenchRunResult[]>();
  for (const result of results) {
    const key = `${result.modelId} ${result.taskId}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(result);
    else byKey.set(key, [result]);
  }
  const rows: PerTaskScore[] = [];
  for (const bucket of byKey.values()) {
    const first = bucket[0];
    if (!first) continue;
    rows.push({
      modelId: first.modelId,
      taskId: first.taskId,
      attempts: bucket.length,
      score: mean(bucket.map((r) => r.grade.score)),
      passed: bucket.every((r) => r.grade.passed),
      failures: bucket.map((r) => r.metrics.failure).filter((f) => f !== "none"),
    });
  }
  return rows.toSorted((a, b) =>
    a.modelId === b.modelId ? a.taskId.localeCompare(b.taskId) : a.modelId.localeCompare(b.modelId),
  );
}

function dimensionMeans(
  taskScores: PerTaskScore[],
  tasks: TaskDefinition[],
): Record<BenchDimension, number | null> {
  const measuresById = new Map(tasks.map((t) => [t.id, t.measures]));
  const buckets = new Map<BenchDimension, number[]>();
  for (const row of taskScores) {
    for (const dimension of measuresById.get(row.taskId) ?? []) {
      const bucket = buckets.get(dimension);
      if (bucket) bucket.push(row.score);
      else buckets.set(dimension, [row.score]);
    }
  }
  const out = {} as Record<BenchDimension, number | null>;
  for (const dimension of BENCH_DIMENSION) {
    const bucket = buckets.get(dimension);
    out[dimension] = bucket && bucket.length > 0 ? mean(bucket) : null;
  }
  return out;
}

/** One row per model. `tasks` supplies the dimension mapping; a task the suite
 *  never ran simply contributes nothing. */
export function perModel(results: BenchRunResult[], tasks: TaskDefinition[]): ModelSummary[] {
  const byModel = new Map<string, BenchRunResult[]>();
  for (const result of results) {
    const bucket = byModel.get(result.modelId);
    if (bucket) bucket.push(result);
    else byModel.set(result.modelId, [result]);
  }

  const allTaskScores = perTask(results);
  const summaries: ModelSummary[] = [];

  for (const [modelId, runs] of byModel) {
    const taskScores = allTaskScores.filter((row) => row.modelId === modelId);
    const costs = runs.map((r) => r.metrics.costUsd).filter((c): c is number => c !== null);
    const ttfts = runs.map((r) => r.metrics.ttftMs).filter((t): t is number => t !== null);
    const totalToolCalls = runs.reduce((sum, r) => sum + r.metrics.toolCalls, 0);
    const totalToolErrors = runs.reduce((sum, r) => sum + r.metrics.toolErrors, 0);
    const totalCostUsd = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null;
    const passedTasks = taskScores.filter((row) => row.passed).length;

    const failures: Partial<Record<BenchFailure, number>> = {};
    for (const run of runs) {
      if (run.metrics.failure === "none") continue;
      failures[run.metrics.failure] = (failures[run.metrics.failure] ?? 0) + 1;
    }

    const parallelByTask = new Map<string, boolean>();
    for (const run of runs) {
      const already = parallelByTask.get(run.taskId) ?? false;
      parallelByTask.set(run.taskId, already || run.metrics.maxParallelWidth >= 2);
    }
    const parallelTasks = [...parallelByTask.values()].filter(Boolean).length;

    summaries.push({
      modelId,
      taskCount: taskScores.length,
      runCount: runs.length,
      quality: mean(taskScores.map((row) => row.score)),
      passRate: taskScores.length === 0 ? 0 : passedTasks / taskScores.length,
      dimensions: dimensionMeans(taskScores, tasks),
      totalCostUsd,
      totalDurationMs: runs.reduce((sum, r) => sum + r.metrics.durationMs, 0),
      totalTurns: runs.reduce((sum, r) => sum + r.metrics.numTurns, 0),
      totalInputTokens: runs.reduce((sum, r) => sum + r.metrics.inputTokens, 0),
      totalOutputTokens: runs.reduce((sum, r) => sum + r.metrics.outputTokens, 0),
      totalCacheReadTokens: runs.reduce((sum, r) => sum + r.metrics.cacheReadTokens, 0),
      totalCacheCreationTokens: runs.reduce((sum, r) => sum + r.metrics.cacheCreationTokens, 0),
      totalThinkingTokens: runs.reduce((sum, r) => sum + r.metrics.thinkingTokens, 0),
      totalToolCalls,
      totalToolErrors,
      toolErrorRate: totalToolCalls === 0 ? 0 : totalToolErrors / totalToolCalls,
      parallelism: parallelByTask.size === 0 ? 0 : parallelTasks / parallelByTask.size,
      // Infinity would sort a model that passed nothing straight to the top of
      // a "cheapest per pass" column. Null forces the report to render a dash.
      costPerPassedTask:
        totalCostUsd === null || passedTasks === 0 ? null : totalCostUsd / passedTasks,
      meanTtftMs: ttfts.length === 0 ? null : mean(ttfts),
      failures,
    });
  }

  return summaries.toSorted((a, b) => a.modelId.localeCompare(b.modelId));
}

/**
 * `best/value` normalisation: the cheapest (or fastest) model scores 1.0, one
 * twice as expensive scores 0.5. Two edge cases are handled explicitly rather
 * than left to produce NaN:
 *  - nobody reported a value, or every reported value is 0, so the term goes
 *    neutral (1.0) for everyone and stops discriminating instead of silently
 *    zeroing every composite;
 *  - a model reported nothing while others did, so it takes the *worst*
 *    observed term - missing data is never an advantage.
 */
function normaliseLowerIsBetter(values: (number | null)[]): number[] {
  const reported = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const positive = reported.filter((v) => v > 0);
  if (positive.length === 0) return values.map(() => 1);
  const best = Math.min(...positive);
  const worstTerm = clamp01(best / Math.max(...positive));
  return values.map((value) => {
    // null is "unpriced" and takes the worst term; 0 is a real, measured zero
    // and takes the best. Collapsing the two - in either direction - is the
    // whole reason cost.ts never returns 0 for a model it cannot price.
    if (value === null || !Number.isFinite(value)) return worstTerm;
    if (value <= 0) return 1;
    return clamp01(best / value);
  });
}

/**
 * The single 0..1 index. Quality 0.50, cost 0.20, speed 0.20, tool fidelity
 * 0.10.
 *
 * A model that failed every task has its cost and speed terms zeroed: failing
 * fast and cheap is not a virtue, and without this a model that 400s on turn 1
 * would top the leaderboard on being the cheapest thing in the field.
 */
export function composite(summaries: ModelSummary[]): CompositeScore[] {
  const costTerms = normaliseLowerIsBetter(summaries.map((s) => s.totalCostUsd));
  const speedTerms = normaliseLowerIsBetter(summaries.map((s) => s.totalDurationMs));

  return summaries
    .map((summary, index) => {
      const quality = clamp01(summary.quality);
      const zeroed = quality === 0;
      const costTerm = zeroed ? 0 : (costTerms[index] ?? 0);
      const speedTerm = zeroed ? 0 : (speedTerms[index] ?? 0);
      const toolFidelityTerm = clamp01(1 - summary.toolErrorRate);
      return {
        modelId: summary.modelId,
        quality,
        costTerm,
        speedTerm,
        toolFidelityTerm,
        composite: clamp01(
          COMPOSITE_WEIGHTS.quality * quality +
            COMPOSITE_WEIGHTS.cost * costTerm +
            COMPOSITE_WEIGHTS.speed * speedTerm +
            COMPOSITE_WEIGHTS.toolFidelity * toolFidelityTerm,
        ),
      };
    })
    .toSorted((a, b) =>
      b.composite === a.composite ? a.modelId.localeCompare(b.modelId) : b.composite - a.composite,
    );
}
