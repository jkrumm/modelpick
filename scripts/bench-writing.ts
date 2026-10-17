/**
 * bench-writing — which model writes best on the owner's real communication
 * jobs (German vault pages, peer-technical articles, landing copy, UI strings,
 * rewrites, personal briefings), judged against the voice guide in
 * brain/voice.md rather than against a leaderboard.
 *
 *   bun run scripts/bench-writing.ts [--models a,b] [--tasks x,y] [--judges a,b]
 *                                    [--concurrency N] [--budget N] [--effort high]
 *                                    [--voice <path>] [--dry-run] [--yes|-y]
 *
 * Every candidate gets the voice guide as its system prompt plus the task's
 * instruction and raw facts, and writes once per task. Then LLM judges from
 * OTHER labs score the anonymized outputs on a nine-point rubric (1-5 with a
 * reason each): a Claude judge never scores Claude output, and so on. Per
 * candidate and task the medians across eligible judges are reported with the
 * judge count beside them, next to a mechanical lint (banned lexical items,
 * negative parallelisms, German Nominalstil, over-long sentences, repeated
 * sentences) that needs no model.
 *
 * Why judges at all, when AGENTS.md distrusts them for writing: they are used
 * to build a shortlist and to rank the failure styles, not to crown a winner.
 * `blind.md` is the human read that decides.
 *
 * A call that hits its token cap with nothing visible is `starved` — a budget
 * failure, never scored as a bad answer — so the default budget is generous
 * (16000 tokens) and `--budget` can lift it.
 *
 * Output lands in docs/experiments/writing/<YYYY-MM-DD>/: report.md,
 * blind.md (outputs A-E shuffled per task), key.json (label -> model),
 * raw.json (outputs, judge JSON, usage). Nothing is written to the DB.
 *
 * Spends real money. Never run this without `--dry-run` from an assistant
 * session — the human runs the priced version; non-interactive shells need
 * `--yes`.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { client } from "../src/db/index.js";
import { KNOWN_EFFORTS, type EffortLevel } from "../src/server/bench/fast-metrics.js";
import { callIu, wireFor, type CallOutcome } from "../src/server/bench/iu-client.js";
import { costOf, loadRates, type Rate } from "../src/server/bench/rates.js";
import {
  blindAssign,
  classifyGeneration,
  isEligibleJudge,
  lintText,
  parseJudgeJson,
  scoreCells,
  type GenerationRecord,
  type JudgeRecord,
} from "../src/server/bench/writing-metrics.js";
import { buildBlind, buildKey, buildReport, type BlindAssignments } from "../src/server/bench/writing-report.js";
import {
  JUDGE_SYSTEM,
  RUBRIC,
  candidatePrompt,
  getWritingTasks,
  judgePrompt,
  type WritingTask,
} from "../src/server/bench/writing-tasks.js";

// ── defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: readonly string[] = [
  "claude-opus-5-5",
  "gemini-4-argon",
  "claude-opus-4-6",
  "claude-fable-5-1",
  "gpt-6-astra",
];

/** One judge per lab, so every candidate keeps at least two eligible judges. */
const DEFAULT_JUDGES: readonly string[] = ["claude-sonnet-5", "gemini-3.8-flash", "gpt-6-luna"];

const DEFAULT_VOICE_PATH = path.join(os.homedir(), "SourceRoot/brain/voice.md");
const DEFAULT_BUDGET = 16_000;
const JUDGE_EFFORT: EffortLevel = "medium";
/** A hang guard, not a budget: a slow writing call at high effort legitimately
 *  runs for minutes. */
const TIMEOUT_MS = 900_000;

// plan-only assumptions for the dry-run estimate
const TYPICAL_CANDIDATE_OUTPUT_TOKENS = 6_000;
const TYPICAL_JUDGE_OUTPUT_TOKENS = 5_000;
const ASSUMED_DRAFT_TOKENS = 900;

// ── flags ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flagValue(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] !== undefined) return args[index + 1] as string;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}

function listValue(name: string): string[] {
  const raw = flagValue(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

const dryRun = args.includes("--dry-run");
const assumeYes = args.includes("--yes") || args.includes("-y");
const concurrency = Math.max(1, Number(flagValue("concurrency") ?? 3));
const budget = Math.max(1, Number(flagValue("budget") ?? DEFAULT_BUDGET));

function parseEffort(): EffortLevel {
  const raw = flagValue("effort") ?? "high";
  if (!KNOWN_EFFORTS.includes(raw as EffortLevel)) {
    throw new Error(`unknown effort "${raw}" — known: ${KNOWN_EFFORTS.join(", ")}`);
  }
  return raw as EffortLevel;
}

async function mapPool<T, R>(items: T[], poolSize: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, run));
  return results;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// ── plan ─────────────────────────────────────────────────────────────────────

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Plan {
  generationCalls: number;
  judgeCalls: number;
  typicalUsd: number | null;
  upperUsd: number | null;
  unpriced: string[];
  perModel: Array<{ model: string; role: string; calls: number; typicalUsd: number | null; upperUsd: number | null }>;
}

function buildPlan(input: {
  models: string[];
  tasks: WritingTask[];
  judges: string[];
  voice: string;
  rates: Map<string, Rate>;
}): Plan {
  const { models, tasks, judges, voice, rates } = input;
  const voiceTokens = approxTokens(voice);
  const perModel: Plan["perModel"] = [];

  for (const model of models) {
    const promptTokens = tasks.map((t) => voiceTokens + approxTokens(candidatePrompt(t)));
    const rate = rates.get(model);
    const typical = promptTokens.map((p) => costOf(rate, p, 0, TYPICAL_CANDIDATE_OUTPUT_TOKENS));
    const upper = promptTokens.map((p) => costOf(rate, p, 0, budget));
    perModel.push({ model, role: "candidate", calls: tasks.length, typicalUsd: sumOrNull(typical), upperUsd: sumOrNull(upper) });
  }

  let judgeCalls = 0;
  for (const judge of judges) {
    const typical: Array<number | null> = [];
    const upper: Array<number | null> = [];
    let calls = 0;
    for (const task of tasks) {
      const drafts = models.filter((m) => isEligibleJudge(judge, m)).length;
      if (drafts === 0) continue;
      calls++;
      const draftText = "x".repeat(ASSUMED_DRAFT_TOKENS * 4);
      const promptTokens =
        approxTokens(JUDGE_SYSTEM) +
        approxTokens(
          judgePrompt({
            task,
            drafts: Array.from({ length: drafts }, (_, i) => ({ label: String.fromCharCode(65 + i), text: draftText })),
          }),
        );
      typical.push(costOf(rates.get(judge), promptTokens, 0, TYPICAL_JUDGE_OUTPUT_TOKENS));
      upper.push(costOf(rates.get(judge), promptTokens, 0, budget));
    }
    judgeCalls += calls;
    perModel.push({ model: judge, role: "judge", calls, typicalUsd: sumOrNull(typical), upperUsd: sumOrNull(upper) });
  }

  return {
    generationCalls: models.length * tasks.length,
    judgeCalls,
    typicalUsd: sumOrNull(perModel.map((p) => p.typicalUsd)),
    upperUsd: sumOrNull(perModel.map((p) => p.upperUsd)),
    unpriced: [...new Set([...models, ...judges])].filter((m) => !rates.has(m)),
    perModel,
  };
}

function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

function usd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function printPlan(plan: Plan): void {
  console.log(
    `  calls:   ${plan.generationCalls} candidate + up to ${plan.judgeCalls} judge (+1 retry per malformed judge reply) = ${plan.generationCalls + plan.judgeCalls} upper bound`,
  );
  for (const row of plan.perModel) {
    console.log(
      `    ${row.role.padEnd(9)} ${row.model.padEnd(20)} ${String(row.calls).padStart(2)} call(s)  ~${usd(row.typicalUsd)} typical · ${usd(row.upperUsd)} if every call uses the full budget`,
    );
  }
  console.log(
    `  estimated cost: ~${usd(plan.typicalUsd)} typical (assumes ${TYPICAL_CANDIDATE_OUTPUT_TOKENS} output tokens per candidate call, ${TYPICAL_JUDGE_OUTPUT_TOKENS} per judge call); ceiling ${usd(plan.upperUsd)}`,
  );
  if (plan.unpriced.length > 0) {
    console.log(`  no price_in/price_out in metric_snapshot for: ${plan.unpriced.join(", ")} — excluded from the estimate`);
  }
}

async function confirmSpend(calls: number): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.log(`Refusing to make ${calls} paid call(s) unattended - re-run with --yes.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Spend that on the full run? [y/N] ");
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

// ── calls ────────────────────────────────────────────────────────────────────

type SettledOutcome = Exclude<CallOutcome, { kind: "unsupported" }>;

async function call(input: {
  model: string;
  effort: EffortLevel;
  system: string;
  prompt: string;
}): Promise<SettledOutcome> {
  const outcome = await callIu({
    ...input,
    maxTokens: budget,
    timeoutMs: TIMEOUT_MS,
    wire: wireFor(input.model, { openaiWire: false }),
  });
  if (outcome.kind !== "unsupported") return outcome;
  return { kind: "error", message: `effort "${input.effort}" rejected: ${outcome.message}`, wallMs: 0 };
}

async function generate(input: {
  task: WritingTask;
  model: string;
  effort: EffortLevel;
  voice: string;
  rate: Rate | undefined;
}): Promise<GenerationRecord> {
  const { task, model, effort, voice, rate } = input;
  const outcome = await call({ model, effort, system: voice, prompt: candidatePrompt(task) });
  if (outcome.kind === "error") {
    console.log(`  ${model} / ${task.id}: ERROR · ${outcome.message}`);
    return {
      task: task.id,
      model,
      status: "error",
      text: "",
      finishReason: null,
      wallMs: outcome.wallMs,
      promptTokens: 0,
      visibleTokens: 0,
      reasoningTokens: 0,
      costUsd: null,
      error: outcome.message,
      lint: null,
    };
  }
  const status = classifyGeneration(outcome.finishReason, outcome.text);
  const record: GenerationRecord = {
    task: task.id,
    model,
    status,
    text: outcome.text,
    finishReason: outcome.finishReason,
    wallMs: outcome.wallMs,
    promptTokens: outcome.promptTokens,
    visibleTokens: outcome.visibleTokens,
    reasoningTokens: outcome.reasoningTokens,
    costUsd: costOf(rate, outcome.promptTokens, outcome.visibleTokens, outcome.reasoningTokens),
    error: status === "ok" ? null : `finish ${outcome.finishReason ?? "—"}, no visible text`,
    lint: status === "ok" ? lintText(outcome.text, task.language) : null,
  };
  console.log(
    `  ${model} / ${task.id}: ${status.toUpperCase()} · wall ${(outcome.wallMs / 1000).toFixed(1)}s · ` +
      `vis ${outcome.visibleTokens} + think ${outcome.reasoningTokens} · finish ${outcome.finishReason ?? "—"} · ` +
      `${record.costUsd !== null ? `$${record.costUsd.toFixed(4)}` : "unpriced"}`,
  );
  return record;
}

async function judgeTask(input: {
  task: WritingTask;
  judge: string;
  candidates: GenerationRecord[];
  rate: Rate | undefined;
  seed: string;
}): Promise<JudgeRecord | null> {
  const { task, judge, candidates, rate, seed } = input;
  const eligible = candidates.filter((c) => c.status === "ok" && isEligibleJudge(judge, c.model));
  if (eligible.length === 0) return null;

  const assigned = blindAssign(
    eligible.map((c) => c.model),
    `${seed}:${task.id}:${judge}`,
  );
  const labels = Object.fromEntries(assigned.map((a) => [a.label, a.model]));
  const drafts = assigned.map(({ label, model }) => ({
    label,
    text: eligible.find((c) => c.model === model)?.text ?? "",
  }));
  const basePrompt = judgePrompt({ task, drafts });
  const criteria = RUBRIC.map((c) => c.id);

  let raw = "";
  let error: string | null = null;
  let wallMs = 0;
  let costUsd: number | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nYour previous reply was rejected (${error}). Reply again with the JSON object only.`;
    const outcome = await call({ model: judge, effort: JUDGE_EFFORT, system: JUDGE_SYSTEM, prompt });
    if (outcome.kind === "error") {
      error = outcome.message;
      wallMs += outcome.wallMs;
      console.log(`  judge ${judge} / ${task.id}: ERROR · ${outcome.message}`);
      return { task: task.id, judge, labels, ok: false, attempts, error, raw, scores: null, wallMs, costUsd };
    }
    wallMs += outcome.wallMs;
    const callCost = costOf(rate, outcome.promptTokens, outcome.visibleTokens, outcome.reasoningTokens);
    costUsd = callCost === null ? costUsd : (costUsd ?? 0) + callCost;
    raw = outcome.text;
    const parsed = parseJudgeJson(outcome.text, Object.keys(labels), criteria);
    if (parsed.ok) {
      console.log(
        `  judge ${judge} / ${task.id}: ok (${eligible.length} draft(s)) · ${(wallMs / 1000).toFixed(1)}s · ` +
          `${costUsd !== null ? `$${costUsd.toFixed(4)}` : "unpriced"}${attempt > 1 ? " · after retry" : ""}`,
      );
      return { task: task.id, judge, labels, ok: true, attempts, error: null, raw, scores: parsed.scores, wallMs, costUsd };
    }
    error = parsed.error;
    console.log(`  judge ${judge} / ${task.id}: malformed reply (${parsed.error})${attempt === 1 ? " — retrying once" : ""}`);
  }
  return { task: task.id, judge, labels, ok: false, attempts, error, raw, scores: null, wallMs, costUsd };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const models = listValue("models").length > 0 ? listValue("models") : [...DEFAULT_MODELS];
  const judges = listValue("judges").length > 0 ? listValue("judges") : [...DEFAULT_JUDGES];
  const tasks = getWritingTasks(listValue("tasks").length > 0 ? listValue("tasks") : undefined);
  const effort = parseEffort();
  const voicePath = flagValue("voice") ?? DEFAULT_VOICE_PATH;
  const voice = await fs.readFile(voicePath, "utf8");

  let rates = new Map<string, Rate>();
  try {
    rates = await loadRates([...new Set([...models, ...judges])]);
  } catch (err) {
    console.log(`  (rate card unavailable: ${err instanceof Error ? err.message : String(err)})`);
  }

  console.log(`bench-writing${dryRun ? " (dry run)" : ""}: ${models.length} candidate(s) x ${tasks.length} task(s), ${judges.length} judge(s), effort ${effort}, budget ${budget}, concurrency ${concurrency}.`);
  console.log(`  candidates: ${models.join(", ")}`);
  console.log(`  judges:     ${judges.join(", ")}  (cross-lab only; effort ${JUDGE_EFFORT})`);
  console.log(`  tasks:      ${tasks.map((t) => t.id).join(", ")}`);
  console.log(`  voice:      ${voicePath} (${voice.length} chars, ~${approxTokens(voice)} tokens) as system prompt`);
  const plan = buildPlan({ models, tasks, judges, voice, rates });
  printPlan(plan);

  if (dryRun) {
    console.log("\nDry run — nothing called, nothing spent.");
    return;
  }
  if (!(await confirmSpend(plan.generationCalls + plan.judgeCalls))) return;

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10);

  console.log("\nGenerating…");
  const pairs = tasks.flatMap((task) => models.map((model) => ({ task, model })));
  const generations = await mapPool(pairs, concurrency, ({ task, model }) =>
    generate({ task, model, effort, voice, rate: rates.get(model) }),
  );

  console.log("\nJudging…");
  const judgeJobs = tasks.flatMap((task) => judges.map((judge) => ({ task, judge })));
  const judgeResults = await mapPool(judgeJobs, concurrency, ({ task, judge }) =>
    judgeTask({
      task,
      judge,
      candidates: generations.filter((g) => g.task === task.id),
      rate: rates.get(judge),
      seed: date,
    }),
  );
  const judgeRecords = judgeResults.filter((r): r is JudgeRecord => r !== null);

  const cells = scoreCells(
    judgeRecords,
    pairs.map(({ task, model }) => ({ task: task.id, model })),
    RUBRIC.map((c) => c.id),
  );
  const assignments: BlindAssignments = Object.fromEntries(
    tasks.map((task) => [task.id, blindAssign(models, `${date}:${task.id}:blind`)]),
  );

  const report = buildReport({
    generatedAt,
    models,
    tasks,
    judges,
    effort,
    budget,
    voicePath,
    generations,
    judgeRecords,
    cells,
  });

  const outDir = path.join(repoRoot(), "docs/experiments/writing", date);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "report.md"), report, "utf8");
  await fs.writeFile(path.join(outDir, "blind.md"), buildBlind({ tasks, assignments, generations }), "utf8");
  await fs.writeFile(path.join(outDir, "key.json"), `${JSON.stringify(buildKey(assignments), null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(outDir, "raw.json"),
    `${JSON.stringify(
      {
        generatedAt,
        config: { models, judges, tasks: tasks.map((t) => t.id), effort, judgeEffort: JUDGE_EFFORT, budget, voicePath },
        generations,
        judgeRecords,
        cells,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n${report}`);
  console.log(`\nWritten to ${outDir} (report.md, blind.md, key.json, raw.json)`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await client.end();
}
