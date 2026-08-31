/**
 * Writes ccbench runs into `bench_run`.
 *
 * Upsert on `(suite_id, model_id, task_id, attempt)`: re-running one model
 * inside an existing suite must correct that row rather than accumulate a
 * second one, or every aggregate silently double-counts.
 */
import { db } from "../../db/index.js";
import { benchRun, type BenchRunInsert } from "../../db/schema.js";
import type { BenchRunResult } from "./types.js";

/** The four columns of the unique index - never part of the conflict update. */
type BenchRunKey = Pick<BenchRunInsert, "suite_id" | "model_id" | "task_id" | "attempt">;
type BenchRunPayload = Omit<BenchRunInsert, keyof BenchRunKey>;

/** SQLite integer columns; the CLI reports fractional millisecond timings. */
function intOrNull(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value);
}

function toKey(result: BenchRunResult): BenchRunKey {
  return {
    suite_id: result.suiteId,
    model_id: result.modelId,
    task_id: result.taskId,
    attempt: result.attempt,
  };
}

function toPayload(result: BenchRunResult): BenchRunPayload {
  const { metrics, grade } = result;
  return {
    ok: metrics.ok,
    failure: metrics.failure,
    score: grade.score,
    passed: grade.passed,
    duration_ms: Math.round(metrics.durationMs),
    api_duration_ms: intOrNull(metrics.apiDurationMs),
    ttft_ms: intOrNull(metrics.ttftMs),
    num_turns: metrics.numTurns,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    cache_read_tokens: metrics.cacheReadTokens,
    cache_creation_tokens: metrics.cacheCreationTokens,
    thinking_tokens: metrics.thinkingTokens,
    cost_usd: metrics.costUsd,
    cost_basis: result.costBasis,
    tool_calls: metrics.toolCalls,
    tool_errors: metrics.toolErrors,
    parallel_batches: metrics.parallelBatches,
    max_parallel_width: metrics.maxParallelWidth,
    api_errors: metrics.apiErrors,
    terminal_reason: metrics.terminalReason,
    // Kept whole so the report can explain *which* part of a task a model
    // dropped without re-running it.
    checks_json: JSON.stringify(grade.checks),
    notes: metrics.notes.length > 0 ? metrics.notes.join(" | ") : null,
    transcript_path: result.transcriptPath,
  };
}

export function toBenchRunInsert(result: BenchRunResult): BenchRunInsert {
  return { ...toKey(result), ...toPayload(result) };
}

export async function persistBenchRun(result: BenchRunResult): Promise<void> {
  await db
    .insert(benchRun)
    .values(toBenchRunInsert(result))
    .onConflictDoUpdate({
      target: [benchRun.suite_id, benchRun.model_id, benchRun.task_id, benchRun.attempt],
      // `created_at` is deliberately not in the update set: it records when the
      // row first landed, and a re-run must not rewrite that.
      set: toPayload(result),
    });
}

/** Sequential on purpose - SQLite takes one writer, and a parallel fan-out here
 *  buys nothing but `SQLITE_BUSY`. */
export async function persistBenchRuns(results: BenchRunResult[]): Promise<void> {
  for (const result of results) {
    await persistBenchRun(result);
  }
}
