/**
 * bench-writing's markdown output — the report, the blind-read sheet and the
 * label key. Pure string builders over the run records so they can be
 * rehearsed with synthetic data; the priced run cannot be re-run to fix a
 * formatting bug. Tables use the minimum separator (`|-|-|`).
 */
import { median } from "./fast-metrics.js";
import {
  leaderboard,
  type GenerationRecord,
  type JudgeRecord,
  type ScoredCell,
} from "./writing-metrics.js";
import { RUBRIC, candidatePrompt, type WritingTask } from "./writing-tasks.js";

const MISSING = "—";

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "-").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join(
    "\n",
  );
}

function score(value: number | null): string {
  return value === null ? MISSING : value.toFixed(2);
}

function usd(value: number | null): string {
  return value === null ? MISSING : `$${value.toFixed(4)}`;
}

function seconds(ms: number | null): string {
  return ms === null ? MISSING : `${(ms / 1000).toFixed(1)}s`;
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export interface ReportInput {
  generatedAt: string;
  models: string[];
  tasks: WritingTask[];
  judges: string[];
  effort: string;
  budget: number;
  voicePath: string;
  generations: GenerationRecord[];
  judgeRecords: JudgeRecord[];
  cells: ScoredCell[];
}

function generationOf(input: ReportInput, task: string, model: string): GenerationRecord | undefined {
  return input.generations.find((g) => g.task === task && g.model === model);
}

function leaderboardSection(input: ReportInput): string {
  const rows = leaderboard(input.cells).map((row, index) => {
    const own = input.generations.filter((g) => g.model === row.model);
    const starved = own.filter((g) => g.status === "starved").length;
    return [
      `${index + 1}`,
      row.model,
      score(row.overall),
      `${row.tasksScored}/${input.tasks.length}`,
      row.minJudges === null ? MISSING : `${row.minJudges}`,
      `${starved}/${own.length}`,
    ];
  });
  return table(["#", "model", "overall (mean of tasks)", "tasks scored", "min judges", "starved"], rows);
}

function taskSection(input: ReportInput, task: WritingTask): string {
  const lintRows = input.models.map((model) => {
    const cell = input.cells.find((c) => c.task === task.id && c.model === model);
    const gen = generationOf(input, task.id, model);
    const lint = gen?.lint ?? null;
    return [
      model,
      score(cell?.overall ?? null),
      cell ? `${cell.judgeCount}` : "0",
      gen ? gen.status : MISSING,
      lint ? `${lint.words}` : MISSING,
      lint ? `${lint.bannedLexical.count}` : MISSING,
      lint ? `${lint.negativeParallelism}` : MISSING,
      lint === null || lint.nominalPer100 === null ? MISSING : `${lint.nominalPer100}`,
      lint ? `${lint.longSentences}` : MISSING,
      lint ? `${lint.repeatedPairs}` : MISSING,
    ];
  });
  const criterionRows = input.models.map((model) => {
    const cell = input.cells.find((c) => c.task === task.id && c.model === model);
    return [model, ...RUBRIC.map((c) => (cell?.perCriterion[c.id] === undefined ? MISSING : `${cell.perCriterion[c.id]}`))];
  });
  return [
    `### ${task.id} — ${task.title}`,
    "",
    table(
      ["model", "overall", "judges", "status", "words", "banned", "neg-par", "-ung/-heit/-keit per 100w", ">30w sentences", "repeat pairs"],
      lintRows,
    ),
    "",
    "Per-criterion median across eligible judges:",
    "",
    table(["model", ...RUBRIC.map((c) => c.id)], criterionRows),
  ].join("\n");
}

function costSection(input: ReportInput): string {
  const rows = input.models.map((model) => {
    const own = input.generations.filter((g) => g.model === model);
    const completion = own.filter((g) => g.status !== "error").map((g) => g.visibleTokens + g.reasoningTokens);
    return [
      model,
      `${own.length}`,
      `${own.filter((g) => g.status === "starved").length}`,
      `${own.filter((g) => g.status === "error").length}`,
      `${own.filter((g) => g.finishReason === "length" && g.status === "ok").length}`,
      seconds(median(own.map((g) => g.wallMs))),
      `${Math.round(median(completion) ?? 0)}`,
      usd(sum(own.map((g) => g.costUsd))),
    ];
  });
  const judgeRows = input.judges.map((judge) => {
    const own = input.judgeRecords.filter((r) => r.judge === judge);
    return [
      judge,
      `${own.length}`,
      `${own.filter((r) => r.ok).length}`,
      `${own.filter((r) => r.attempts > 1).length}`,
      usd(sum(own.map((r) => r.costUsd))),
    ];
  });
  const total = sum([...input.generations.map((g) => g.costUsd), ...input.judgeRecords.map((r) => r.costUsd)]);
  return [
    table(
      ["model", "calls", "starved", "errors", "truncated", "median wall", "median out tokens", "cost"],
      rows,
    ),
    "",
    "Judges:",
    "",
    table(["judge", "calls", "parsed", "retried", "cost"], judgeRows),
    "",
    `Total spend: ${usd(total)} (cost from usage tokens x the metric_snapshot rate card; a model with no rate reads ${MISSING}).`,
  ].join("\n");
}

function failureSection(input: ReportInput): string {
  const lines = [
    ...input.generations
      .filter((g) => g.status !== "ok")
      .map((g) => `- generation ${g.model} / ${g.task}: ${g.status}${g.error ? ` — ${g.error}` : ""}`),
    ...input.judgeRecords
      .filter((r) => !r.ok)
      .map((r) => `- judge ${r.judge} / ${r.task}: no usable scores — ${r.error ?? "unknown"}`),
  ];
  return lines.length === 0 ? "None." : lines.join("\n");
}

const CAVEATS = [
  "**Judging is cross-lab only.** A judge never scores its own lab's output, so a cell is judged by the",
  "judges that remain (`judges` column) and different candidates are judged by different panels. Read a",
  "cell with one judge as one opinion. Scores are medians across judges, overall is the mean of the",
  "nine criterion medians.",
  "",
  "**LLM judges are not the reader.** Judges favoured the Opus-5 style in earlier writing benchmarks while",
  "the owner did not (see EQ-Bench in AGENTS.md). Treat the score as a shortlist; the blind read in",
  "`blind.md` decides.",
  "",
  "**Lint is a smoke detector.** The mechanical columns count surface patterns from the voice guide",
  "(banned lexical items in English output, negative parallelisms, German -ung/-heit/-keit density,",
  "sentences over 30 words, near-duplicate sentence pairs). A hit means look here, not bad prose. English",
  "tech terms inside German text are never flagged.",
  "",
  "**`starved`** is a call that hit its token cap with nothing visible. It is a budget failure, counted",
  "separately and never scored as a bad answer. **`truncated`** is a call that hit the cap with partial",
  "text; it is judged as written.",
].join("\n");

export function buildReport(input: ReportInput): string {
  return [
    "# bench-writing report",
    "",
    `Generated ${input.generatedAt}. Candidates: ${input.models.join(", ")}. Judges: ${input.judges.join(", ")}.`,
    `Tasks: ${input.tasks.map((t) => t.id).join(", ")}. Effort: ${input.effort}. Token budget per call: ${input.budget}.`,
    `System prompt: ${input.voicePath} plus the task instruction.`,
    "",
    "## Leaderboard",
    "",
    leaderboardSection(input),
    "",
    "## Per task",
    "",
    input.tasks.map((t) => taskSection(input, t)).join("\n\n"),
    "",
    "## Cost and latency",
    "",
    costSection(input),
    "",
    "## Failures",
    "",
    failureSection(input),
    "",
    "## How to read this",
    "",
    CAVEATS,
    "",
  ].join("\n");
}

// ── blind read sheet and key ─────────────────────────────────────────────────

export type BlindAssignments = Record<string, Array<{ label: string; model: string }>>;

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

export function buildBlind(input: {
  tasks: WritingTask[];
  assignments: BlindAssignments;
  generations: GenerationRecord[];
}): string {
  const sections = input.tasks.map((task) => {
    const assigned = input.assignments[task.id] ?? [];
    const outputs = assigned.map(({ label, model }) => {
      const gen = input.generations.find((g) => g.task === task.id && g.model === model);
      const body = gen && gen.status === "ok" ? gen.text.trim() : `(no output: ${gen?.status ?? "not run"})`;
      return [`#### ${label}`, "", body, ""].join("\n");
    });
    return [
      `## ${task.id} — ${task.title}`,
      "",
      "Task prompt given to every model (system prompt: the voice guide):",
      "",
      quote(candidatePrompt(task)),
      "",
      ...outputs,
    ].join("\n");
  });
  return [
    "# bench-writing blind read",
    "",
    "Outputs are labelled by a per-task shuffle. Read, rank, then open key.json.",
    "",
    sections.join("\n---\n\n"),
    "",
  ].join("\n");
}

export function buildKey(assignments: BlindAssignments): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(assignments).map(([task, list]) => [task, Object.fromEntries(list.map((a) => [a.label, a.model]))]),
  );
}
