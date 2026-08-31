/**
 * Shared contract for the Claude Code agentic benchmark ("ccbench").
 *
 * What this measures and why it exists: modelpick's other probes ask what the
 * IU endpoint *serves*. This one asks the only question that decides which id
 * goes in `ANTHROPIC_DEFAULT_*_MODEL` — how well a model drives an actual
 * Claude Code agent loop over the IU Anthropic route. Every number here comes
 * from a real `claude -p` run against a real sandbox checkout, graded
 * mechanically, never from a leaderboard.
 */

import type { BenchFailureReason, CostBasis } from "../../db/schema.js";

/** Axes a task is designed to separate models on. Reported per-dimension so a
 *  model that is only good at search is visibly only good at search. */
export const BENCH_DIMENSION = [
  "search", // finding the right code without reading the world
  "coding", // writing correct code to a spec
  "multi_file", // keeping several files coherent in one change
  "recovery", // reading an error and converging instead of thrashing
  "tool_use", // batching, argument validity, not re-reading the same file
  "adherence", // obeying CLAUDE.md-style project rules under temptation
  "reasoning", // getting a non-obvious algorithm or constraint right, not just plausible
] as const;
export type BenchDimension = (typeof BENCH_DIMENSION)[number];

/** Why a run produced no usable grade. `incompatible` is the interesting one:
 *  the model is served, but the gateway/model pair cannot drive the agent loop
 *  (tool schema rejected, thinking blocks it can't turn off, 400 on every turn).
 *  The tuple lives in schema.ts because the `bench_run.failure` column needs it;
 *  re-exported here so bench code never imports the schema for a plain type. */
export { BENCH_FAILURE } from "../../db/schema.js";
export type BenchFailure = BenchFailureReason;

/** How a run's `costUsd` was arrived at — see `cost.ts`. Same arrangement as
 *  BENCH_FAILURE: the tuple lives in schema.ts because the column needs it. */
export { COST_BASIS } from "../../db/schema.js";
export type { CostBasis };

/** One mechanically-checked assertion inside a task's grade. Partial credit is
 *  the point — "compiled but ignored half the spec" must not score like "failed". */
export interface BenchCheck {
  name: string;
  ok: boolean;
  /** Relative weight inside the task; defaults to 1 when omitted. */
  weight?: number;
  detail?: string;
}

export interface TaskGrade {
  /** 0..1, weighted mean of `checks`. */
  score: number;
  /** True only when every non-zero-weight check passed. */
  passed: boolean;
  checks: BenchCheck[];
}

/** Everything a grader is allowed to look at. Graders must be deterministic and
 *  offline — no model calls, no network — so a re-grade of a stored transcript
 *  gives the same number. */
export interface GradeContext {
  /** Absolute path to the sandbox the agent worked in. */
  dir: string;
  /** The agent's final assistant text (`result` in the CLI's result event). */
  finalText: string;
  /** Parsed metrics from the stream-json transcript. */
  metrics: RunMetrics;
  /** Runs a command inside `dir`; never throws on a non-zero exit. */
  run: (cmd: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>;
  /** Reads a sandbox-relative file; null when missing. */
  readFile: (relPath: string) => Promise<string | null>;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface BenchTask {
  id: string;
  title: string;
  measures: BenchDimension[];
  /** Directory name under `fixtures/bench/` copied into a fresh sandbox. */
  fixture: string;
  /** The prompt handed to `claude -p`. Identical for every model — any model
   *  specific hint here invalidates the comparison. */
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  /**
   * Files the agent must never see, copied in from
   * `fixtures/bench/<fixture>/.hidden/` only after the run ends. Sandbox-relative
   * destination paths. This is what stops a model from writing a test that
   * asserts whatever it happened to implement.
   */
  hidden?: Record<string, string>;
  grade: (ctx: GradeContext) => Promise<TaskGrade>;
}

/** Everything the stream-json transcript yields. Populated by the parser, not
 *  by the model — a model claiming success in prose changes nothing here. */
export interface RunMetrics {
  ok: boolean;
  failure: BenchFailure;
  /** Wall clock from spawn to exit — the number that decides whether a model is
   *  tolerable to sit behind, and the one `duration_api_ms` hides. */
  durationMs: number;
  /** Time the CLI attributes to API calls (excludes local tool execution). */
  apiDurationMs: number | null;
  /** Time to first token of the first assistant message. */
  ttftMs: number | null;
  numTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  /** What the run cost. As parsed it is the CLI's own accounting
   *  (`modelUsage[*].costUSD`, list basis); the runner then re-prices it from a
   *  real rate card where one resolves — see `cost.ts` and `BenchRunResult.costBasis`.
   *  Null means genuinely unpriced, never "free". */
  costUsd: number | null;
  toolCalls: number;
  /** `tool_use` blocks by tool name — shows a model that greps when it should read. */
  toolCallsByName: Record<string, number>;
  /** `tool_result` blocks flagged `is_error` — the single best tool-fidelity signal. */
  toolErrors: number;
  /** Assistant messages carrying >1 `tool_use` block. */
  parallelBatches: number;
  /** Largest number of `tool_use` blocks in one assistant message. */
  maxParallelWidth: number;
  /** Non-2xx API responses observed in the stream. */
  apiErrors: number;
  terminalReason: string | null;
  /** Distinct sandbox-relative paths the agent wrote to. */
  filesEdited: string[];
  /** Anything the parser wants the report to surface verbatim. */
  notes: string[];
}

export interface BenchRunResult {
  suiteId: string;
  modelId: string;
  taskId: string;
  attempt: number;
  startedAt: string;
  metrics: RunMetrics;
  grade: TaskGrade;
  transcriptPath: string;
  /** Where `metrics.costUsd` came from. A suite mixing a Claude id and a
   *  DeepSeek id mixes bases, so this has to be per-run, not per-suite. */
  costBasis: CostBasis;
}
