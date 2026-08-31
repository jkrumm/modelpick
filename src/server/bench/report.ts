/**
 * Renders a ccbench suite as markdown. Pure: strings in, string out - no fs, no
 * db, no clock. That is what lets a report be regenerated from stored rows
 * without re-running the benchmark.
 *
 * Table style follows the house rule (dotfiles/rules/formatting.md): markdown
 * pipes with minimum `|-|-|` separators, never padded, never box-drawn.
 *
 * Cost is never printed without its basis. A suite that mixes a Claude id with
 * a DeepSeek id mixes bases (see cost.ts), which is now the normal case, so the
 * caveat under the title names the basis when the whole suite shares one and
 * the table grows a `basis` column when it does not.
 */
import type { CompositeScore, ModelSummary, PerTaskScore } from "./score.js";
import { BENCH_DIMENSION, type BenchRunResult, type CostBasis } from "./types.js";

const MISSING = "—";

export interface ReportInput {
  suiteId: string;
  generatedAt: string;
  /** Task ids in the order they should appear as matrix columns. */
  taskIds: string[];
  summaries: ModelSummary[];
  composites: CompositeScore[];
  taskScores: PerTaskScore[];
  results: BenchRunResult[];
  /** True when the suite ran against the stub spawner - the report must say so
   *  loudly, or a dry-run table gets mistaken for a measurement. */
  dryRun?: boolean;
}

function n2(value: number): string {
  return value.toFixed(2);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

function duration(ms: number): string {
  if (!Number.isFinite(ms)) return MISSING;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function ratio(value: number | null): string {
  return value === null ? MISSING : n2(value);
}

/** Minimum-separator markdown table - never pad the separator row. */
function mdTable(headers: string[], rows: string[][]): string {
  const separator = `|${headers.map(() => "-").join("|")}|`;
  const head = `| ${headers.join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [head, separator, ...body].join("\n");
}

/** A model whose own runs disagree is `mixed` - which is a real finding, not a
 *  rendering problem, so it gets its own label rather than a first-wins guess. */
type BasisLabel = CostBasis | "mixed";

function basisByModel(results: BenchRunResult[]): Map<string, BasisLabel> {
  const seen = new Map<string, Set<CostBasis>>();
  for (const result of results) {
    const bucket = seen.get(result.modelId);
    if (bucket) bucket.add(result.costBasis);
    else seen.set(result.modelId, new Set([result.costBasis]));
  }
  const out = new Map<string, BasisLabel>();
  for (const [modelId, bases] of seen) {
    const only = bases.size === 1 ? [...bases][0] : null;
    out.set(modelId, only ?? "mixed");
  }
  return out;
}

/** The suite-wide basis, or null when the suite mixes them. */
function suiteBasis(results: BenchRunResult[]): CostBasis | null {
  const bases = new Set(results.map((r) => r.costBasis));
  if (bases.size > 1) return null;
  // An empty suite has nothing to disagree about; keep the historical label.
  return [...bases][0] ?? "list";
}

const BASIS_CAVEAT: Record<CostBasis, string> = {
  measured:
    "Cost basis: **measured** — computed from this model's own per-token rates (`pick_probe`, solved from the gateway's billing), not an IU invoice.",
  list: 'Cost is Anthropic **list pricing** (`costBasis: "list"` — the CLI\'s own number, or the committed Claude rate card), not an IU invoice.',
  unpriced:
    "Cost basis: **unpriced** — no rate card resolved for any model in this suite, so every cost cell is a dash.",
};

const MIXED_CAVEAT =
  "Cost basis is **mixed** across this suite — see the `basis` column. `measured` rows are computed from per-token rates solved from the gateway's own billing (`pick_probe`); `list` rows are Anthropic **list pricing**, which the CLI applies even to ids it has never heard of and therefore over-prices; `unpriced` rows have no rate card at all and render a dash.";

function costCaveat(results: BenchRunResult[]): string {
  const basis = suiteBasis(results);
  return basis === null ? MIXED_CAVEAT : BASIS_CAVEAT[basis];
}

const COST_HEADER: Record<CostBasis, string> = {
  measured: "cost (measured)",
  list: "cost (list)",
  unpriced: "cost",
};

function leaderboard(input: ReportInput): string {
  const byModel = new Map(input.summaries.map((s) => [s.modelId, s]));
  const basis = suiteBasis(input.results);
  const labels = basisByModel(input.results);
  const rows = input.composites.map((entry) => {
    const summary = byModel.get(entry.modelId);
    return [
      entry.modelId,
      n2(entry.composite),
      n2(entry.quality),
      summary ? pct(summary.passRate) : MISSING,
      money(summary?.totalCostUsd ?? null),
      ...(basis === null ? [labels.get(entry.modelId) ?? MISSING] : []),
      summary ? duration(summary.totalDurationMs) : MISSING,
      summary && summary.runCount > 0 ? n2(summary.totalTurns / summary.runCount) : MISSING,
      summary ? pct(summary.toolErrorRate) : MISSING,
    ];
  });
  return mdTable(
    [
      "model",
      "composite",
      "quality",
      "pass rate",
      basis === null ? "cost" : COST_HEADER[basis],
      ...(basis === null ? ["basis"] : []),
      "wall",
      "mean turns",
      "tool err",
    ],
    rows,
  );
}

function taskMatrix(input: ReportInput): string {
  const byKey = new Map(input.taskScores.map((row) => [`${row.modelId} ${row.taskId}`, row]));
  const rows = input.composites.map((entry) => [
    entry.modelId,
    ...input.taskIds.map((taskId) => {
      const cell = byKey.get(`${entry.modelId} ${taskId}`);
      if (!cell) return MISSING;
      return `${n2(cell.score)} ${cell.passed ? "y" : "n"}`;
    }),
  ]);
  return mdTable(["model", ...input.taskIds], rows);
}

function dimensionMatrix(input: ReportInput): string {
  const byModel = new Map(input.summaries.map((s) => [s.modelId, s]));
  const rows = input.composites.map((entry) => {
    const summary = byModel.get(entry.modelId);
    return [
      entry.modelId,
      ...BENCH_DIMENSION.map((dimension) => ratio(summary?.dimensions[dimension] ?? null)),
    ];
  });
  return mdTable(["model", ...BENCH_DIMENSION], rows);
}

/** One line per non-clean run. The transcript path is the receipt - anything
 *  surprising in the table is meant to be checked against it, not re-argued. */
function failureNotes(input: ReportInput): string {
  const lines: string[] = [];
  for (const result of input.results) {
    const label = `${result.modelId} / ${result.taskId} #${result.attempt}`;
    if (result.metrics.failure !== "none") {
      lines.push(`- **${label}** — failure: \`${result.metrics.failure}\``);
    }
    for (const note of result.metrics.notes) {
      lines.push(`- ${label} — ${note}`);
    }
  }
  if (lines.length === 0)
    return "No failures, no parser notes - every run produced a clean transcript.";
  return lines.join("\n");
}

export function renderReport(input: ReportInput): string {
  const banner = input.dryRun
    ? "\n> **Dry run.** Transcripts are synthetic - no model was called and no money was spent.\n"
    : "";
  return [
    `# ccbench — ${input.suiteId}`,
    "",
    `Generated ${input.generatedAt}. ${input.summaries.length} model(s) over ${input.taskIds.length} task(s).`,
    banner,
    costCaveat(input.results),
    "",
    "## Leaderboard",
    "",
    leaderboard(input),
    "",
    "## Per-task scores",
    "",
    "Cell is the mean score across attempts, followed by `y` when every attempt passed.",
    "",
    taskMatrix(input),
    "",
    "## Per-dimension scores",
    "",
    dimensionMatrix(input),
    "",
    "## Failures and notes",
    "",
    failureNotes(input),
    "",
  ].join("\n");
}

export interface BenchReportJson {
  suite_id: string;
  generated_at: string;
  dry_run: boolean;
  /** The suite-wide basis, or "mixed" when its runs disagree. */
  cost_basis: CostBasis | "mixed";
  task_ids: string[];
  leaderboard: {
    model_id: string;
    composite: number;
    quality: number;
    cost_term: number;
    speed_term: number;
    tool_fidelity_term: number;
    pass_rate: number | null;
    total_cost_usd: number | null;
    total_duration_ms: number | null;
    mean_turns: number | null;
    tool_error_rate: number | null;
    parallelism: number | null;
    cost_per_passed_task: number | null;
    mean_ttft_ms: number | null;
    dimensions: Record<string, number | null>;
    failures: Record<string, number>;
  }[];
  per_task: {
    model_id: string;
    task_id: string;
    attempts: number;
    score: number;
    passed: boolean;
    failures: string[];
  }[];
  runs: {
    model_id: string;
    task_id: string;
    attempt: number;
    ok: boolean;
    failure: string;
    score: number;
    passed: boolean;
    duration_ms: number;
    cost_usd: number | null;
    cost_basis: CostBasis;
    tool_calls: number;
    tool_errors: number;
    max_parallel_width: number;
    files_edited: string[];
    notes: string[];
    transcript_path: string;
  }[];
}

export function toJson(input: ReportInput): BenchReportJson {
  const byModel = new Map(input.summaries.map((s) => [s.modelId, s]));
  return {
    suite_id: input.suiteId,
    generated_at: input.generatedAt,
    dry_run: input.dryRun === true,
    cost_basis: suiteBasis(input.results) ?? "mixed",
    task_ids: input.taskIds,
    leaderboard: input.composites.map((entry) => {
      const summary = byModel.get(entry.modelId);
      return {
        model_id: entry.modelId,
        composite: entry.composite,
        quality: entry.quality,
        cost_term: entry.costTerm,
        speed_term: entry.speedTerm,
        tool_fidelity_term: entry.toolFidelityTerm,
        pass_rate: summary?.passRate ?? null,
        total_cost_usd: summary?.totalCostUsd ?? null,
        total_duration_ms: summary?.totalDurationMs ?? null,
        mean_turns: summary && summary.runCount > 0 ? summary.totalTurns / summary.runCount : null,
        tool_error_rate: summary?.toolErrorRate ?? null,
        parallelism: summary?.parallelism ?? null,
        cost_per_passed_task: summary?.costPerPassedTask ?? null,
        mean_ttft_ms: summary?.meanTtftMs ?? null,
        dimensions: summary ? { ...summary.dimensions } : {},
        failures: summary ? { ...summary.failures } : {},
      };
    }),
    per_task: input.taskScores.map((row) => ({
      model_id: row.modelId,
      task_id: row.taskId,
      attempts: row.attempts,
      score: row.score,
      passed: row.passed,
      failures: [...row.failures],
    })),
    runs: input.results.map((result) => ({
      model_id: result.modelId,
      task_id: result.taskId,
      attempt: result.attempt,
      ok: result.metrics.ok,
      failure: result.metrics.failure,
      score: result.grade.score,
      passed: result.grade.passed,
      duration_ms: result.metrics.durationMs,
      cost_usd: result.metrics.costUsd,
      cost_basis: result.costBasis,
      tool_calls: result.metrics.toolCalls,
      tool_errors: result.metrics.toolErrors,
      max_parallel_width: result.metrics.maxParallelWidth,
      files_edited: result.metrics.filesEdited,
      notes: result.metrics.notes,
      transcript_path: result.transcriptPath,
    })),
  };
}
