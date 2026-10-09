/**
 * bench-decision — which decision model should a typed-answer lane run?
 *
 *   bun run bench:decision [--models a,b] [--tasks contact-form-verdict,email-triage]
 *                          [--repeat N] [--dry-run]
 *
 * Decision models (Clef, Jev, PPLX Decider, Luna's Decisions route) answer yes/no,
 * choice and score questions with probabilities and generate no text, so no chat
 * leaderboard and none of bench-fast's tasks can say anything about them. This runs
 * email-gateway's real questions (src/server/bench/decision-tasks.ts) on graded
 * cases, `--repeat` times each (default 3), and reports per model:
 *
 *   accuracy      graded questions answered correctly (macro average over suites)
 *   Brier         calibration of the returned probabilities (lower is better)
 *   p50 latency   median wall time of one call
 *   $/1k calls    reported `usage.cost`; the Decisions wire reports none, so Luna's
 *                 cost is estimated from the rate card and marked as such
 *   error rate    failed calls (HTTP, timeout, malformed) — counted apart from wrong
 *   refusal rate  questions the model declined to answer
 *
 * Results go to `metric_snapshot` (source `live`, metrics `decision_*`) — the
 * /decision tab ranks from them — and the report to
 * docs/experiments/decision-YYYY-MM-DD/report.md. The pure aggregation lives in
 * src/server/bench/decision-metrics.ts; this file only drives the calls.
 *
 * Spends real money (about $0.0001 per call on the Clef family). Never run this
 * without `--dry-run` from an assistant session unless the brief says so.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, desc, inArray } from "drizzle-orm";
import { client, db } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";
import { decisionSpec } from "../src/db/decision-models.js";
import { callDecision, DecisionError } from "../src/server/iu/decision-client.js";
import {
  getDecisionTasks,
  gradeCase,
  type DecisionTask,
} from "../src/server/bench/decision-tasks.js";
import {
  metricsOf,
  rankDecisionRows,
  summarizeModel,
  type DecisionCallRecord,
  type ModelSummary,
} from "../src/server/bench/decision-metrics.js";

type MetricRow = typeof metricSnapshot.$inferInsert;

const CANDIDATE_MODELS: readonly string[] = [
  "clef",
  "clef-eu",
  "clef-flash",
  "pplx-decider-v1-27b",
  "jev-latest",
  "gpt-6-luna:decisions",
];

const CALL_TIMEOUT_MS = 60_000;

// ── flags ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flagValue(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] !== undefined) return args[index + 1] as string;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}

function listValue(name: string): string[] {
  return (flagValue(name) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

const dryRun = args.includes("--dry-run");
const repeats = Math.max(1, Number(flagValue("repeat") ?? 3));

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// ── rate card (cost estimate for wires that report none) ─────────────────────

interface Rate {
  input: number;
  output: number;
}

/** Latest USD-per-1M `price_in`/`price_out` per catalog model id; a model with no
 *  rate gets no entry, so its cost stays null instead of guessed. */
async function loadRates(modelIds: string[]): Promise<Map<string, Rate>> {
  const rows = await db
    .select({
      model_id: metricSnapshot.model_id,
      metric: metricSnapshot.metric,
      value: metricSnapshot.value,
    })
    .from(metricSnapshot)
    .where(
      and(
        inArray(metricSnapshot.model_id, modelIds),
        inArray(metricSnapshot.metric, ["price_in", "price_out"]),
      ),
    )
    .orderBy(desc(metricSnapshot.captured_at));
  const priceIn = new Map<string, number>();
  const priceOut = new Map<string, number>();
  for (const row of rows) {
    if (row.metric === "price_in" && !priceIn.has(row.model_id)) priceIn.set(row.model_id, row.value);
    if (row.metric === "price_out" && !priceOut.has(row.model_id)) priceOut.set(row.model_id, row.value);
  }
  const rates = new Map<string, Rate>();
  for (const id of modelIds) {
    const input = priceIn.get(id);
    const output = priceOut.get(id);
    if (input !== undefined && output !== undefined) rates.set(id, { input, output });
  }
  return rates;
}

// ── one model's run ──────────────────────────────────────────────────────────

async function runModel(
  model: string,
  tasks: DecisionTask[],
  rounds: number,
  rate: Rate | undefined,
): Promise<DecisionCallRecord[]> {
  const records: DecisionCallRecord[] = [];
  for (let repeat = 1; repeat <= rounds; repeat++) {
    for (const task of tasks) {
      for (const testCase of task.cases) {
        const start = performance.now();
        const base = { model, task: task.id, caseId: testCase.id, repeat };
        try {
          const result = await callDecision({
            modelId: model,
            state: testCase.state,
            questions: task.questions,
            baseUrl: env("IU_OPENAI_BASE_URL"),
            apiKey: env("IU_API_KEY"),
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          });
          const wallMs = performance.now() - start;
          const reported = result.usage.costUsd;
          const estimated =
            reported === null && rate !== undefined
              ? (result.usage.inputTokens * rate.input + result.usage.outputTokens * rate.output) /
                1_000_000
              : null;
          records.push({
            ...base,
            wallMs,
            costUsd: reported ?? estimated,
            costEstimated: reported === null && estimated !== null,
            error: null,
            grades: gradeCase(task, testCase, result.answers),
          });
        } catch (err) {
          records.push({
            ...base,
            wallMs: performance.now() - start,
            costUsd: null,
            costEstimated: false,
            error:
              err instanceof DecisionError
                ? err.message.slice(0, 160)
                : err instanceof Error
                  ? err.message
                  : String(err),
            grades: [],
          });
        }
      }
    }
  }
  return records;
}

// ── report ───────────────────────────────────────────────────────────────────

const pct = (v: number | null): string => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const fixed = (v: number | null, digits: number): string => (v === null ? "—" : v.toFixed(digits));

function costCell(s: ModelSummary): string {
  if (s.costPer1kCallsUsd === null) return "—";
  return `$${s.costPer1kCallsUsd.toFixed(3)}${s.costEstimated ? " (est.)" : ""}`;
}

/** Cases a model got wrong in at least half its graded repeats — where the field splits. */
function missesSection(records: DecisionCallRecord[], models: string[]): string {
  const lines: string[] = [];
  const keys = new Set(records.map((r) => `${r.task}/${r.caseId}`));
  for (const key of keys) {
    const missed: string[] = [];
    for (const model of models) {
      const rows = records.filter((r) => `${r.task}/${r.caseId}` === key && r.model === model && r.error === null);
      const grades = rows.flatMap((r) => r.grades).filter((g) => g.outcome !== "refused");
      if (grades.length === 0) continue;
      const wrong = grades.filter((g) => g.outcome === "wrong").length;
      if (wrong * 2 >= grades.length) missed.push(`${model} (${wrong}/${grades.length})`);
    }
    if (missed.length > 0) lines.push(`| \`${key}\` | ${missed.join(", ")} |`);
  }
  if (lines.length === 0) return "No case was missed by any model in half or more of its graded answers.";
  return ["| case | models that missed it (wrong/graded) |", "|-|-|", ...lines].join("\n");
}

function buildReport(input: {
  generatedAt: string;
  models: string[];
  tasks: DecisionTask[];
  rounds: number;
  summaries: ModelSummary[];
  records: DecisionCallRecord[];
  spendUsd: number;
  spendEstimated: boolean;
  fullRun: boolean;
}): string {
  const { generatedAt, models, tasks, rounds, summaries, records, spendUsd, spendEstimated, fullRun } = input;
  const ranked = rankDecisionRows(summaries);

  const headline = [
    "| # | model | accuracy | Brier | p50 ms | $/1k calls | errors | refusals | unstable cases |",
    "|-|-|-|-|-|-|-|-|-|",
    ...ranked.map((s, i) => {
      const spec = decisionSpec(s.model);
      const region = spec?.region === "eu" ? " (EU)" : "";
      return `| ${i + 1} | \`${s.model}\`${region} | ${pct(s.accuracy)} | ${fixed(s.brier, 4)} | ${fixed(s.latencyP50Ms, 0)} | ${costCell(s)} | ${s.errorCalls}/${s.calls} | ${pct(s.refusalRate)} | ${s.unstableCases} |`;
    }),
  ].join("\n");

  const suiteTable = [
    `| model | ${tasks.map((t) => `\`${t.id}\``).join(" | ")} |`,
    `|-|${tasks.map(() => "-").join("|")}|`,
    ...ranked.map(
      (s) =>
        `| \`${s.model}\` | ${tasks.map((t) => pct(s.suites.find((x) => x.task === t.id)?.accuracy ?? null)).join(" | ")} |`,
    ),
  ].join("\n");

  const errorModels = ranked.filter((s) => s.errorCalls > 0);
  const errorSection =
    errorModels.length === 0
      ? "No call failed."
      : errorModels
          .map((s) => {
            const sample = records.find((r) => r.model === s.model && r.error !== null)?.error ?? "";
            return `- \`${s.model}\`: ${s.errorCalls}/${s.calls} calls failed. First error: ${sample}`;
          })
          .join("\n");

  return [
    "# bench-decision report",
    "",
    `Generated ${generatedAt}. Models: ${models.join(", ")}. Suites: ${tasks.map((t) => `${t.id} (${t.cases.length} cases)`).join(", ")}. Repeats: ${rounds}.`,
    `Total spend: $${spendUsd.toFixed(4)}${spendEstimated ? " (includes rate-card estimates for the Decisions wire, which reports no cost)" : ""}.`,
    fullRun ? "" : "\n> Partial run (`--tasks`): only per-suite accuracy was written to `metric_snapshot`.",
    "",
    "## Headline",
    "",
    "Ranked by accuracy (macro average over suites), then Brier, then median latency; a model failing more than 10% of calls is ranked below every reliable one.",
    "",
    headline,
    "",
    "## Accuracy per suite",
    "",
    suiteTable,
    "",
    "## Where the field splits",
    "",
    missesSection(records, models),
    "",
    "## Errors",
    "",
    errorSection,
    "",
    "## Caveats",
    "",
    "- Accuracy saturates: on a clean suite most models score the same, so Brier (calibration) and latency decide the order. A perfect score clears a floor, it does not prove the model is good (GUIDELINES §3.6).",
    "- Brier is the multi-class squared error over the question's options for choice questions, and the squared error of P(yes) for boolean ones. Score questions have no probability target and contribute accuracy only.",
    "- Errors (HTTP, timeout, malformed envelope) are excluded from accuracy, latency and cost, and reported on their own. A refusal is neither correct nor wrong.",
    "- `unstable cases` counts (suite, case) pairs whose graded outcome differed between repeats.",
    "- Cases are synthetic; labels follow each question's own instructions. A case two defensible labels could fit was rewritten, not kept as hard.",
    "- Latency is wall time of one non-streaming call from the dev host to IU's unified endpoint, not model time.",
    "",
  ].join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const requestedModels = listValue("models");
  const models = requestedModels.length > 0 ? requestedModels : [...CANDIDATE_MODELS];
  const requestedTasks = listValue("tasks");
  const tasks = getDecisionTasks(requestedTasks);
  const fullRun = requestedTasks.length === 0;

  const casesPerRound = tasks.reduce((sum, t) => sum + t.cases.length, 0);
  const totalCalls = models.length * casesPerRound * repeats;
  console.log(
    `bench-decision${dryRun ? " (dry run)" : ""}: ${models.length} model(s) x ${casesPerRound} case(s) x ` +
      `${repeats} repeat(s) = ${totalCalls} call(s); models run in parallel, calls within a model in sequence.`,
  );
  console.log(`  models: ${models.join(", ")}`);
  console.log(`  tasks:  ${tasks.map((t) => `${t.id} (${t.cases.length})`).join(", ")}`);

  if (dryRun) {
    console.log("\nDry run — nothing called, nothing spent.");
    await client.end();
    return;
  }

  // The Decisions wire reports no cost; price it from the chat model's rate card.
  const rateIds = [...new Set(models.map((m) => decisionSpec(m)?.apiModel ?? m))];
  const rates = await loadRates(rateIds);

  const perModel = await Promise.all(
    models.map((model) => runModel(model, tasks, repeats, rates.get(decisionSpec(model)?.apiModel ?? model))),
  );
  const records = perModel.flat();
  const summaries = models.map((m) => summarizeModel(m, records));

  const spendUsd = records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const spendEstimated = records.some((r) => r.costEstimated);
  console.log(`\nSpend: $${spendUsd.toFixed(4)}${spendEstimated ? " (incl. estimates)" : ""} across ${records.length} calls.`);

  const generatedAt = new Date().toISOString();
  const report = buildReport({
    generatedAt,
    models,
    tasks,
    rounds: repeats,
    summaries,
    records,
    spendUsd,
    spendEstimated,
    fullRun,
  });
  console.log(`\n${report}`);

  const rows: MetricRow[] = summaries.flatMap((s) =>
    metricsOf(s, fullRun).map((p) => ({
      model_id: s.model,
      source: "live" as const,
      metric: p.metric,
      value: p.value,
      confidence: 0.85,
    })),
  );
  try {
    if (rows.length > 0) await db.insert(metricSnapshot).values(rows);
  } catch (err) {
    // A model missing from the catalog fails the FK — run `bun run db:seed` first.
    console.log(`  (metric_snapshot skipped: ${err instanceof Error ? err.message : String(err)})`);
  }

  const reportDir = path.join(repoRoot(), "docs/experiments", `decision-${generatedAt.slice(0, 10)}`);
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, "report.md"), report, "utf8");
  console.log(`\nReport written to ${path.join(reportDir, "report.md")}`);

  await client.end();
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  await client.end();
  process.exitCode = 1;
}
