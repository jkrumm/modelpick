/**
 * ccbench - how well does a model actually drive a Claude Code agent loop?
 *
 *   bun run scripts/bench.ts [--models a,b] [--tasks t1,t2] [--repeats 1]
 *                            [--suite <id>] [--concurrency 2] [--json]
 *                            [--timeout-scale 1]
 *                            [--keep] [--dry-run] [--yes|-y]
 *                            [--include-incompatible]
 *   bun run scripts/bench.ts --reprice [--suite <id>]   # free, no model calls
 *
 * modelpick's other probes ask what the IU endpoint *serves*. This one asks the
 * only question that decides which id goes into `ANTHROPIC_DEFAULT_*_MODEL`:
 * given a real fixture checkout, a real `claude -p` session and a fixed prompt,
 * does the model find the code, change it correctly, and stop? Every number
 * comes from a mechanically graded sandbox, never from a leaderboard.
 *
 * Caveats worth holding before reading any table it prints:
 *  - Cost is priced from token counts against a real rate card wherever one
 *    resolves (`pick_probe` for non-Claude ids, a committed Anthropic list card
 *    for the Claude ones) and only falls back to the CLI's own figure when
 *    neither knows the id. The CLI prices unknown ids at a Claude-tier default,
 *    which is why a raw `total_cost_usd` is meaningless for a non-Claude model.
 *    Even the measured number is a comparator, not an IU invoice.
 *  - Runs are stochastic. One repeat is a signal, not a measurement; `--repeats`
 *    is what turns a suspicion into a number.
 *  - Every run uses an isolated `CLAUDE_CONFIG_DIR`, so these numbers describe
 *    the model, not the operator's global CLAUDE.md, MCP servers and hooks.
 *  - `--dry-run` exercises the whole pipeline against a synthetic transcript.
 *    It validates the harness and proves nothing about any model.
 *
 * Spends real money without `--dry-run`.
 */
import { createInterface } from "node:readline/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { client, db } from "../src/db/index.js";
import { benchRun, pickProbe } from "../src/db/schema.js";
import {
  CCBENCH_MODELS,
  isClaudeCodeIncompatible,
  isDeadModel,
} from "../src/server/bench/models.js";
import {
  createSandbox,
  ensureBenchConfigDir,
  makeGradeContext,
  removeSandbox,
  repoRoot,
  revealHidden,
  sanitizeSegment,
  suiteSandboxRoot,
} from "../src/server/bench/sandbox.js";
import {
  extractFinalText,
  harnessErrorMetrics,
  parseTranscript,
} from "../src/server/bench/metrics.js";
import {
  makeStubSpawner,
  resolveCredentials,
  spawnClaude,
  type IuCredentials,
  type Spawner,
} from "../src/server/bench/spawn.js";
import { persistBenchRuns } from "../src/server/bench/persist.js";
import { priceRun, priceRunResult, type Rates } from "../src/server/bench/cost.js";
import { composite, perModel, perTask } from "../src/server/bench/score.js";
import { renderReport, toJson } from "../src/server/bench/report.js";
import type { BenchRunResult, BenchTask, TaskGrade } from "../src/server/bench/types.js";
import { BENCH_TASKS, FIXTURE_ROOT, getTasks } from "../src/server/bench/tasks.js";

const DEFAULT_CONCURRENCY = 2;

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

const jsonMode = args.includes("--json");
/** Recompute stored costs from stored token counts. Touches no model, spends
 *  nothing - the repair path for suites persisted with the CLI's figure. */
const repriceMode = args.includes("--reprice");
const dryRun = args.includes("--dry-run");
const keepSandboxes = args.includes("--keep");
/** Skip the spend confirmation. Required in a non-interactive shell. */
const assumeYes = args.includes("--yes") || args.includes("-y");
/** Re-test the ids that 503 on every Claude Code request - the only reason to
 *  ask for them is to check whether the gateway has since been fixed. */
const includeIncompatible = args.includes("--include-incompatible");
const repeats = Math.max(1, Number(flagValue("repeats") ?? 1));
const concurrency = Math.max(1, Number(flagValue("concurrency") ?? DEFAULT_CONCURRENCY));
/**
 * Multiplies every task's `timeoutMs`. A task timeout is a latency budget, not a
 * capability judgement — a model can do the work correctly and still be killed
 * for being slow, which is exactly what `glm-5.3-flash` did on the hard tier.
 * Scaling it up is how you tell "cannot" apart from "not within ten minutes".
 */
const timeoutScale = Math.max(1, Number(flagValue("timeout-scale") ?? 1));
const modelFilter = listValue("models");
const taskFilter = listValue("tasks");

function defaultSuiteId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date}-${time}${dryRun ? "-dry" : ""}`;
}
const suiteId = flagValue("suite") ?? defaultSuiteId();

async function mapPool<T, R>(
  items: T[],
  poolSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
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

/**
 * Per-token rates for the non-Claude ids, solved by `bun run pick` from the
 * gateway's own `usage.cost` and cached in `pick_probe`. Loaded once: the
 * table is small and every run needs the same map.
 */
async function loadProbeRates(): Promise<Map<string, Rates>> {
  const rows = await db.select().from(pickProbe);
  const rates = new Map<string, Rates>();
  for (const row of rows) {
    if (row.price_in_per_m === null || row.price_out_per_m === null) continue;
    rates.set(row.model_id, {
      inPerM: row.price_in_per_m,
      outPerM: row.price_out_per_m,
      cacheReadPerM: row.price_cache_read_per_m,
      // The probe never solves a cache-write rate; cost.ts applies the 1.25x
      // input default rather than pretending cache writes are free.
      cacheWritePerM: null,
    });
  }
  return rates;
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(6)}`;
}

/**
 * Recompute `cost_usd` / `cost_basis` for already-stored rows. No model is
 * called and no transcript is re-read - the token counts in `bench_run` are the
 * whole input.
 *
 * Guardrail: a row whose rate card no longer resolves keeps the number it
 * already had (basis `list`), and a row with no token counts at all is skipped
 * outright. A missing rate must never zero out a real number.
 */
async function reprice(suiteFilter: string | null): Promise<void> {
  const probeRates = await loadProbeRates();
  const rows = suiteFilter
    ? await db.select().from(benchRun).where(eq(benchRun.suite_id, suiteFilter))
    : await db.select().from(benchRun);

  if (rows.length === 0) {
    console.log(`No stored runs${suiteFilter ? ` in suite ${suiteFilter}` : ""} - nothing to do.`);
    return;
  }

  console.log(
    `Repricing ${rows.length} run(s)${suiteFilter ? ` in suite ${suiteFilter}` : " across every suite"} against ${probeRates.size} probed rate card(s).`,
  );

  const lines: string[] = ["| model | task | before | after | basis | change |", "|-|-|-|-|-|-|"];
  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    const tokens = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
    };
    const totalTokens =
      tokens.inputTokens +
      tokens.outputTokens +
      tokens.cacheReadTokens +
      tokens.cacheCreationTokens;
    if (totalTokens === 0) {
      skipped++;
      lines.push(
        `| ${row.model_id} | ${row.task_id} | ${money(row.cost_usd)} | ${money(row.cost_usd)} | ${row.cost_basis} | skipped (no tokens) |`,
      );
      continue;
    }

    const priced = priceRun(
      { modelId: row.model_id, tokens, reportedCostUsd: row.cost_usd },
      probeRates,
    );
    const same = priced.costUsd === row.cost_usd && priced.basis === row.cost_basis;
    if (!same) {
      await db
        .update(benchRun)
        .set({ cost_usd: priced.costUsd, cost_basis: priced.basis })
        .where(eq(benchRun.id, row.id));
      changed++;
    }
    const factor =
      row.cost_usd !== null && row.cost_usd > 0 && priced.costUsd !== null
        ? `${(priced.costUsd / row.cost_usd).toFixed(3)}x`
        : "—";
    lines.push(
      `| ${row.model_id} | ${row.task_id} | ${money(row.cost_usd)} | ${money(priced.costUsd)} | ${priced.basis} | ${factor} |`,
    );
  }

  console.log(`\n${lines.join("\n")}`);
  console.log(`\n${changed} row(s) rewritten, ${skipped} skipped for want of token counts.`);
}

/**
 * Every run is a real agent session against a paid gateway, so the suite never
 * starts implicitly. A non-interactive shell has nobody to answer and must pass
 * --yes rather than have the prompt silently auto-accept.
 */
async function confirmSpend(runCount: number): Promise<boolean> {
  if (dryRun || assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.log(`Refusing to run ${runCount} agent session(s) unattended - re-run with --yes.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Spend that on a full suite? [y/N] ");
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

interface PlannedRun {
  modelId: string;
  task: BenchTask;
  attempt: number;
}

const FAILED_GRADE: TaskGrade = { score: 0, passed: false, checks: [] };

function graderCrashGrade(message: string): TaskGrade {
  return {
    score: 0,
    passed: false,
    checks: [{ name: "grader", ok: false, detail: `grader threw: ${message}` }],
  };
}

function transcriptPathFor(run: PlannedRun): string {
  return path.join(
    repoRoot(),
    "docs/experiments/ccbench",
    sanitizeSegment(suiteId),
    `${sanitizeSegment(run.modelId)}__${sanitizeSegment(run.task.id)}__${run.attempt}.jsonl`,
  );
}

/**
 * One (model, task, attempt). Never throws: a fixture that will not copy or a
 * grader that blows up is recorded as `harness_error` and the suite carries on.
 */
async function executeRun(
  run: PlannedRun,
  spawner: Spawner,
  credentials: IuCredentials,
  configDir: string,
): Promise<BenchRunResult> {
  const startedAt = new Date().toISOString();
  const transcriptPath = transcriptPathFor(run);
  const base = {
    suiteId,
    modelId: run.modelId,
    taskId: run.task.id,
    attempt: run.attempt,
    startedAt,
    transcriptPath,
    // Provisional: whatever the CLI reported. `priceRunResult` in the caller
    // replaces both this and `metrics.costUsd` once the rate card is known.
    costBasis: "list" as const,
  };

  let sandboxDir: string | null = null;
  const began = Date.now();
  try {
    sandboxDir = await createSandbox({
      suiteId,
      modelId: run.modelId,
      taskId: run.task.id,
      attempt: run.attempt,
      fixtureRoot: FIXTURE_ROOT,
      fixture: run.task.fixture,
    });

    const outcome = await spawner({
      modelId: run.modelId,
      prompt: run.task.prompt,
      maxTurns: run.task.maxTurns,
      timeoutMs: run.task.timeoutMs * timeoutScale,
      cwd: sandboxDir,
      configDir,
      transcriptPath,
      credentials,
    });

    const metrics = parseTranscript({
      raw: outcome.raw,
      durationMs: outcome.durationMs,
      killed: outcome.killed,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      sandboxDir,
    });

    // Withheld files land only now - a model that could read the reference test
    // would be graded on its ability to read, not to code.
    await revealHidden(sandboxDir, FIXTURE_ROOT, run.task.fixture, run.task.hidden);

    // A killed or errored run still gets graded: a partial diff can still score.
    const context = makeGradeContext(sandboxDir, extractFinalText(outcome.raw), metrics);
    let grade: TaskGrade;
    try {
      grade = await run.task.grade(context);
    } catch (err) {
      grade = graderCrashGrade(err instanceof Error ? err.message : String(err));
    }

    return { ...base, metrics, grade };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[bench] ${run.modelId} / ${run.task.id} #${run.attempt}: ${message}`);
    return {
      ...base,
      metrics: harnessErrorMetrics(message, Date.now() - began),
      grade: FAILED_GRADE,
    };
  } finally {
    if (sandboxDir && !keepSandboxes) {
      await removeSandbox(sandboxDir).catch(() => undefined);
    }
  }
}

/** `getTasks` throws on an unknown id; a typo in --tasks deserves one clear
 *  line, not a stack trace. */
function selectTasks(): BenchTask[] | null {
  try {
    const tasks = getTasks(taskFilter.length > 0 ? taskFilter : undefined);
    if (tasks.length > 0) return tasks;
    console.error(
      "Nothing to run: the task registry (src/server/bench/tasks.ts) is empty - no fixtures have landed yet.",
    );
  } catch (err) {
    console.error(`Nothing to run: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Known task ids: ${BENCH_TASKS.map((t) => t.id).join(", ")}`);
  }
  return null;
}

async function main(): Promise<void> {
  if (repriceMode) {
    await reprice(flagValue("suite"));
    await client.end();
    return;
  }

  const tasks = selectTasks();
  if (!tasks) {
    await client.end();
    process.exitCode = 1;
    return;
  }

  const models = modelFilter.length > 0 ? modelFilter : [...CCBENCH_MODELS];
  const dead = models.filter(isDeadModel);
  if (dead.length > 0) {
    console.log(`Skipping known-dead ids (503 on every call): ${dead.join(", ")}`);
  }
  const incompatible = includeIncompatible ? [] : models.filter(isClaudeCodeIncompatible);
  if (incompatible.length > 0) {
    console.log(
      `Skipping Claude Code-incompatible ids (503 on every CLI request, ~190s of retries each): ${incompatible.join(", ")} - re-run with --include-incompatible to re-test them.`,
    );
  }
  const liveModels = models.filter((id) => !isDeadModel(id) && !incompatible.includes(id));
  if (liveModels.length === 0) {
    console.error(
      "Nothing to run: every requested model is known-dead or Claude Code-incompatible.",
    );
    await client.end();
    process.exitCode = 1;
    return;
  }

  const planned: PlannedRun[] = [];
  for (const modelId of liveModels) {
    for (const task of tasks) {
      for (let attempt = 1; attempt <= repeats; attempt++) {
        planned.push({ modelId, task, attempt });
      }
    }
  }

  console.log(
    `ccbench ${suiteId}${dryRun ? " (dry run - synthetic transcripts, no API calls)" : ""}`,
  );
  console.log(
    `${liveModels.length} model(s) x ${tasks.length} task(s) x ${repeats} repeat(s) = ${planned.length} agent session(s), concurrency ${concurrency}.`,
  );

  if (!(await confirmSpend(planned.length))) {
    console.log("Aborted - nothing run, nothing spent.");
    await client.end();
    return;
  }

  const credentials: IuCredentials = dryRun
    ? { apiKey: "dry-run", baseUrl: "https://example.invalid", source: "env" }
    : resolveCredentials();
  const configDir = await ensureBenchConfigDir();
  const spawner: Spawner = dryRun ? makeStubSpawner() : spawnClaude;
  // Loaded once, before any run: the CLI's own cost figure is only trustworthy
  // for ids it knows, so every result is re-priced against this map.
  const probeRates = await loadProbeRates();

  const results = await mapPool(planned, concurrency, async (run) => {
    const result = priceRunResult(
      await executeRun(run, spawner, credentials, configDir),
      probeRates,
    );
    console.log(
      `  ${run.modelId} / ${run.task.id} #${run.attempt}: score ${result.grade.score.toFixed(2)} ${result.grade.passed ? "pass" : "fail"} (${result.metrics.failure})`,
    );
    return result;
  });

  // The per-run sandboxes are already gone; this drops the empty suite tree.
  if (!keepSandboxes) await removeSandbox(suiteSandboxRoot(suiteId)).catch(() => undefined);

  await persistBenchRuns(results);

  const summaries = perModel(results, tasks);
  const reportInput = {
    suiteId,
    generatedAt: new Date().toISOString(),
    taskIds: tasks.map((t) => t.id),
    summaries,
    composites: composite(summaries),
    taskScores: perTask(results),
    results,
    dryRun,
  };

  const markdown = renderReport(reportInput);
  const reportPath = path.join(
    repoRoot(),
    "docs/experiments/ccbench",
    sanitizeSegment(suiteId),
    "report.md",
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, markdown, "utf8");

  if (jsonMode) console.log(JSON.stringify(toJson(reportInput), null, 2));
  else console.log(`\n${markdown}\nReport written to ${reportPath}`);

  await client.end();
}

await main();
