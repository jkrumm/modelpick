/**
 * bench-fast — does DeepSeek-V4.1-Flash actually beat gpt-5.6-luna once effort
 * is set properly, on wall time to a CORRECT answer, not time-to-first-token?
 *
 *   bun run scripts/bench-fast.ts [--models a,b] [--efforts default,low]
 *                                 [--tasks extract,reason] [--repeat N]
 *                                 [--concurrency N] [--dry-run]
 *
 * The existing fast-model evidence (docs/decisions/fast-model.md) is TTFT-led,
 * single-effort and unrepeated — it cannot tell "starts late, decodes fast" from
 * "actually slower". This probes the whole `reasoning_effort` ladder per model
 * (default/none/low/medium/high), on five small mechanically-graded tasks, with
 * `--repeat` (default 3) repeats per cell, and reports the median wall time to a
 * passing answer.
 *
 * Things a headline TTFT number cannot see, which this is built to surface:
 *  - `reasoning_effort` is not uniformly honoured. Some routes (Requesty, in
 *    particular) accept it with HTTP 200 and never actually change the model's
 *    behaviour — docs/decisions/hermes-brain.md measured deepseek-v4.1-flash's
 *    think/visible ratio moving only 0.78 → 0.70 across `default` → `low`. This
 *    script computes that per model as `honoured` / `accepted-but-ignored` /
 *    `unsupported`, from whether the median reasoning-token count actually moves.
 *  - A non-2xx that *mentions* `reasoning_effort`, or one whose body is not
 *    even JSON, is a real "unsupported" signal — the cell is skipped entirely
 *    (no graded failures recorded for it), not silently retried or scored.
 *  - Four of the five tasks are TTFT-dominated — a handful of visible tokens
 *    never lets a late starter earn its head start back on decode speed. The
 *    fifth, `longform` (~1200 words), plus the "Crossover" report section
 *    (crossoverOf/crossoverSection below), answers the question a short task
 *    structurally cannot: past what output length does a later-starting,
 *    faster-decoding model overtake it?
 *  - A thinking model can spend its whole token budget on hidden reasoning and
 *    return zero visible text — `docs/decisions/hermes-brain.md` already
 *    documents this at a 500-token Gemini cap. Budgets here are generous
 *    (4000 short / 8000 longform) specifically so that cannot happen, and any
 *    call that still hits its cap with nothing visible is classified `starved`
 *    — a budget failure, never graded as a wrong answer.
 *  - Some routes misreport reasoning tokens, in both directions: reporting
 *    zero on a call that is provably still thinking (inferUsage's fallback,
 *    reused from benchmark-bakeoff.ts's shape-agnostic accounting), or
 *    reporting a suspicious fixed constant across every task and effort
 *    (reasoningLooksConstant) — the latter marks a model's reasoning columns
 *    `unreliable` rather than printing a number that is not a measurement.
 *
 * The pure aggregation (usage inference, per-cell medians, classification) is
 * unit-tested via src/server/bench/fast-metrics.ts — this file is the thin
 * orchestrator that drives real HTTP calls and hands results to it.
 *
 * Spends real money. Never run this without `--dry-run` from an assistant
 * session — the human runs the priced version.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, desc, inArray } from "drizzle-orm";
import { client, db } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";
import type { Thinking } from "../src/db/schema.js";
import { getFastTasks, type FastTask } from "../src/server/bench/fast-tasks.js";
import {
  ALL_EFFORTS,
  classifyOutcome,
  inferUsage,
  reasoningLooksConstant,
  summarizeCell,
  type CallRow,
  type CellResult,
  type CellSummary,
  type EffortLevel,
} from "../src/server/bench/fast-metrics.js";

type MetricRow = typeof metricSnapshot.$inferInsert;

/** Models not yet in the catalog fail the FK — don't lose a live run over it,
 *  same guard as benchmark-bakeoff.ts's recordMetrics(). */
async function recordMetrics(rows: MetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(metricSnapshot).values(rows);
  } catch (err) {
    console.log(`  (metric_snapshot skipped: ${err instanceof Error ? err.message : String(err)})`);
  }
}

// ── candidates & effort ladder ───────────────────────────────────────────────

const CANDIDATE_MODELS: readonly string[] = [
  "gpt-5.6-luna",
  "deepseek-v4.1-flash",
  "gemini-3.8-flash",
  "glm-5.3-flash",
  "minimax-m3",
];

/** `default` sends no reasoning parameter at all; every other level is sent
 *  literally as `reasoning_effort`. */
function reasoningExtra(effort: EffortLevel): Record<string, unknown> | undefined {
  return effort === "default" ? undefined : { reasoning_effort: effort };
}

/** `THINKING` has no `"none"` value — the schema's word for suppressed
 *  reasoning is `"off"`, matching benchmark-bakeoff.ts's conditionsOf(). */
function conditionsFor(effort: EffortLevel): Thinking {
  return effort === "none" ? "off" : effort;
}

const TIMEOUT_MS = 120_000;

// ── rate card (from metric_snapshot, never hardcoded) ────────────────────────

interface Rate {
  input: number;
  output: number;
}

/** Latest `price_in`/`price_out` per model, in USD per 1M tokens, from whatever
 *  source most recently reported it. A model with no rate gets no entry — its
 *  cost stays null rather than guessed. */
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

// ── SSE parsing (verbatim in intent from benchmark-bakeoff.ts's readSse) ─────

async function readSse(resp: Response, onEvent: (parsed: unknown) => void): Promise<void> {
  if (!resp.body) throw new Error("no response body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        // partial SSE frame — ignore
      }
    }
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// ── one call ─────────────────────────────────────────────────────────────────

type CallOutcome =
  | {
      kind: "ok";
      ttfbMs: number | null;
      ttftMs: number | null;
      wallMs: number;
      visibleTokens: number;
      reasoningTokens: number;
      reportedReasoningTokens: number;
      promptTokens: number;
      finishReason: string | null;
      hasUsage: boolean;
      text: string;
    }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string; wallMs: number };

/** The two outcomes `toCallRow` actually accepts — `runCell` handles
 *  `"unsupported"` itself and never forwards it. */
type SettledOutcome = Exclude<CallOutcome, { kind: "unsupported" }>;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

async function runCall(model: string, effort: EffortLevel, task: FastTask): Promise<CallOutcome> {
  const start = performance.now();
  let resp: Response;
  try {
    resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env("IU_API_KEY")}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: task.prompt }],
        max_completion_tokens: task.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningExtra(effort),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? TIMEOUT_MS : performance.now() - start,
    };
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    // A non-2xx that names the parameter in its body, or one that is not even
    // JSON (glm-5.3-flash rejecting `medium`, observed live 2026-09-12), is
    // the real "the route rejects this effort level" signal — anything else
    // is a generic failure.
    const unsupported = effort !== "default" && (/reasoning_effort/i.test(bodyText) || !parsesAsJson(bodyText));
    if (unsupported) {
      return { kind: "unsupported", message: bodyText.slice(0, 200) || `HTTP ${resp.status}, non-JSON body` };
    }
    return {
      kind: "error",
      message: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`,
      wallMs: performance.now() - start,
    };
  }

  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let text = "";
  let promptTokens = 0;
  let visibleTokens = 0;
  let reasoningTokens = 0;
  let reportedReasoningTokens = 0;
  let finishReason: string | null = null;
  let hasUsage = false;

  try {
    await readSse(resp, (event) => {
      const parsed = event as {
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string; reasoning?: string };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      // Any parsed frame counts toward ttfb, including a reasoning-only delta —
      // the point is separating transport latency from thinking time, not just
      // measuring time to visible text.
      firstFrameAt ??= performance.now();
      const fr = parsed.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        firstTokenAt ??= performance.now();
        text += delta;
      }
      if (parsed.usage) {
        const promptTok = parsed.usage.prompt_tokens ?? 0;
        const completionTok = parsed.usage.completion_tokens ?? 0;
        const totalTok = parsed.usage.total_tokens ?? 0;
        const reported = parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0;
        promptTokens = promptTok;
        // inferUsage carries the same shape-agnostic double-billing fix
        // benchmark-bakeoff.ts documents, plus the fallback that shape alone
        // misses: a route reporting `reasoning_tokens: 0` while still visibly
        // thinking — see src/server/bench/fast-metrics.ts for the derivation.
        const inferred = inferUsage({
          promptTokens: promptTok,
          completionTokens: completionTok,
          totalTokens: totalTok,
          reportedReasoningTokens: reported,
          streamedText: text,
        });
        visibleTokens = inferred.visibleTokens;
        reasoningTokens = inferred.reasoningTokens;
        reportedReasoningTokens = inferred.reportedReasoningTokens;
        hasUsage = true;
      }
    });
  } catch (err) {
    return {
      kind: "error",
      message: isTimeout(err) ? "timeout mid-stream" : err instanceof Error ? err.message : String(err),
      wallMs: isTimeout(err) ? TIMEOUT_MS : performance.now() - start,
    };
  }

  const end = performance.now();
  return {
    kind: "ok",
    ttfbMs: firstFrameAt === null ? null : firstFrameAt - start,
    ttftMs: firstTokenAt === null ? null : firstTokenAt - start,
    wallMs: end - start,
    visibleTokens: visibleTokens > 0 ? visibleTokens : Math.round(text.length / 4),
    reasoningTokens,
    reportedReasoningTokens,
    promptTokens,
    finishReason,
    hasUsage,
    text,
  };
}

// ── per-call row & cell aggregation ──────────────────────────────────────────

function costOf(rate: Rate | undefined, promptTokens: number, visible: number, reasoning: number): number | null {
  if (!rate) return null;
  return (promptTokens * rate.input + (visible + reasoning) * rate.output) / 1_000_000;
}

function toCallRow(task: FastTask, repeat: number, outcome: SettledOutcome, rate: Rate | undefined): CallRow {
  if (outcome.kind !== "ok") {
    return {
      taskId: task.id,
      repeat,
      ttfbMs: null,
      ttftMs: null,
      thinkMs: 0,
      wallMs: outcome.wallMs,
      visibleTokens: 0,
      reasoningTokens: 0,
      reportedReasoningTokens: 0,
      finishReason: null,
      outcomeKind: "fail",
      costUsd: null,
      hasUsage: false,
    };
  }
  const thinkMs =
    outcome.ttfbMs !== null && outcome.ttftMs !== null ? Math.max(0, outcome.ttftMs - outcome.ttfbMs) : 0;
  const passed = task.grade(outcome.text);
  return {
    taskId: task.id,
    repeat,
    ttfbMs: outcome.ttfbMs,
    ttftMs: outcome.ttftMs,
    thinkMs,
    wallMs: outcome.wallMs,
    visibleTokens: outcome.visibleTokens,
    reasoningTokens: outcome.reasoningTokens,
    reportedReasoningTokens: outcome.reportedReasoningTokens,
    finishReason: outcome.finishReason,
    outcomeKind: classifyOutcome(outcome.finishReason, outcome.visibleTokens, passed),
    costUsd: costOf(rate, outcome.promptTokens, outcome.visibleTokens, outcome.reasoningTokens),
    hasUsage: outcome.hasUsage,
  };
}

function outcomeLabel(kind: CallRow["outcomeKind"]): string {
  if (kind === "pass") return "pass";
  if (kind === "starved") return "STARVED";
  return "FAIL";
}

/** Runs every task x repeat for one (model, effort) cell, sequentially — never
 *  concurrent within a model, so its own latency numbers are never distorted by
 *  a sibling call. Stops the cell the moment a call reports the parameter as
 *  unsupported; already-collected rows for that cell are discarded (the brief's
 *  "skip its repeats"), and the cell is recorded as unsupported. */
async function runCell(
  model: string,
  effort: EffortLevel,
  tasks: FastTask[],
  repeats: number,
  rate: Rate | undefined,
): Promise<CellResult> {
  const rows: CallRow[] = [];
  for (const task of tasks) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const outcome = await runCall(model, effort, task);
      if (outcome.kind === "unsupported") {
        console.log(`  ${model} / ${effort}: unsupported — ${outcome.message}`);
        return { model, effort, supported: false, rows: [] };
      }
      const row = toCallRow(task, repeat, outcome, rate);
      rows.push(row);
      const snippet =
        row.outcomeKind === "fail" && outcome.kind === "ok"
          ? ` · "${outcome.text.slice(0, 120).replaceAll("\n", " ")}"`
          : "";
      console.log(
        `  ${model} / ${effort} / ${task.id} #${repeat}: ${outcomeLabel(row.outcomeKind)} · ` +
          `wall ${row.wallMs.toFixed(0)}ms · ttft ${row.ttftMs?.toFixed(0) ?? "—"}ms · ` +
          `think ${row.thinkMs.toFixed(0)}ms · vis ${row.visibleTokens} + think ${row.reasoningTokens} ` +
          `(reported ${row.reportedReasoningTokens}) · finish ${row.finishReason ?? "—"} · ` +
          `${row.costUsd !== null ? `$${row.costUsd.toFixed(6)}` : "unpriced"}${snippet}`,
      );
    }
  }
  return { model, effort, supported: true, rows };
}

// ── per-model verdict: honoured / accepted-but-ignored / unsupported / unreliable

type Verdict = "honoured" | "accepted-but-ignored" | "unsupported" | "unreliable";

/**
 * A model is `unsupported` when every non-default effort level rejected the
 * parameter. Otherwise, compare each supported level's median reasoning-token
 * count against `default`'s: if every one sits within ±20%, the route accepts
 * the parameter but never actually changes behaviour (`accepted-but-ignored`,
 * the shape documented for deepseek-v4.1-flash in docs/decisions/hermes-brain.md
 * — think/visible ratio moving only 0.78 → 0.70). Any level outside that band
 * means the dial does something, so the model is `honoured`. Never called for a
 * model flagged `reasoningLooksConstant` — that model gets `unreliable`
 * unconditionally, since these medians are not trustworthy for it (see main()).
 */
function modelVerdict(cells: CellSummary[]): Verdict {
  const byEffort = new Map(cells.map((c) => [c.effort, c]));
  const defaultCell = byEffort.get("default");
  const nonDefault = (["none", "low", "medium", "high"] as const)
    .map((e) => byEffort.get(e))
    .filter((c): c is CellSummary => c !== undefined);
  const supported = nonDefault.filter((c) => c.supported);
  if (supported.length === 0) return "unsupported";
  const defaultMedian = defaultCell?.medianReasoningTokens ?? null;
  if (defaultMedian === null) return "honoured";
  const allWithinBand = supported.every((c) => {
    const value = c.medianReasoningTokens ?? 0;
    return Math.abs(value - defaultMedian) <= defaultMedian * 0.2;
  });
  return allWithinBand ? "accepted-but-ignored" : "honoured";
}

// ── crossover: does the faster decoder actually win? ─────────────────────────
//
// Every task but `longform` is dominated by TTFT — a handful of visible tokens
// never lets a late starter earn its head start back on decode speed. This
// answers the question that actually motivated this script: at what output
// length does a later-starting, faster-decoding model overtake gpt-5.6-luna?
// Computed at `default` effort — the setting a real caller actually gets — from
// the same complete-row medians `summarizeCell` derives, so a fix to those
// medians (defect #1) automatically corrects this section too.

const BASELINE_MODEL = "gpt-5.6-luna";
const LONGFORM_TASK_ID = "longform";

interface CrossoverResult {
  /** The later-starting, faster-decoding model of the pair — the one whose
   *  output has to get long enough to win. Null when neither model dominates
   *  the other on both axes (an inconsistent pair: e.g. later-starting AND
   *  slower-decoding), which makes "crossover length" undefined either way. */
  laterModel: string | null;
  earlierModel: string | null;
  /** Output length in tokens beyond which `laterModel` finishes first. Null
   *  when one model starts earlier AND decodes faster — it wins at every
   *  length, so there is no crossover to report. */
  crossoverTokens: number | null;
  /** Set only when `crossoverTokens` is null: the model that wins regardless
   *  of output length. */
  alwaysWinner: string | null;
  /** `laterModel`'s own median visible-token count on the longform task, for
   *  comparing against `crossoverTokens` directly in the report line. */
  longformVisibleTokens: number | null;
}

function crossoverOf(
  modelId: string,
  modelCell: CellSummary | undefined,
  baselineCell: CellSummary | undefined,
): CrossoverResult | null {
  if (!modelCell?.supported || !baselineCell?.supported) return null;
  const ttftA = modelCell.medianTtftMs;
  const rateA = modelCell.decodeTokPerSec;
  const ttftB = baselineCell.medianTtftMs;
  const rateB = baselineCell.decodeTokPerSec;
  if (ttftA === null || rateA === null || ttftB === null || rateB === null) return null;

  // model later + faster than baseline
  if (ttftA > ttftB && rateA > rateB) {
    const crossoverTokens = (ttftB / 1000 - ttftA / 1000) / (1 / rateA - 1 / rateB);
    return {
      laterModel: modelId,
      earlierModel: BASELINE_MODEL,
      crossoverTokens,
      alwaysWinner: null,
      longformVisibleTokens: modelCell.taskMedianVisibleTokens[LONGFORM_TASK_ID] ?? null,
    };
  }
  // baseline later + faster than model
  if (ttftB > ttftA && rateB > rateA) {
    const crossoverTokens = (ttftA / 1000 - ttftB / 1000) / (1 / rateB - 1 / rateA);
    return {
      laterModel: BASELINE_MODEL,
      earlierModel: modelId,
      crossoverTokens,
      alwaysWinner: null,
      longformVisibleTokens: baselineCell.taskMedianVisibleTokens[LONGFORM_TASK_ID] ?? null,
    };
  }
  // One model starts no later AND decodes no slower than the other — it wins
  // (or ties) at every output length, so there is no crossover.
  const modelDominates = ttftA <= ttftB && rateA >= rateB;
  return {
    laterModel: null,
    earlierModel: null,
    crossoverTokens: null,
    alwaysWinner: modelDominates ? modelId : BASELINE_MODEL,
    longformVisibleTokens: modelCell.taskMedianVisibleTokens[LONGFORM_TASK_ID] ?? null,
  };
}

function crossoverLine(modelId: string, result: CrossoverResult | null): string {
  if (result === null) {
    return `- **${modelId}**: n/a — no \`default\`-effort data for this model or the baseline.`;
  }
  if (result.crossoverTokens === null) {
    return `- **${modelId}**: n/a — **${result.alwaysWinner}** starts no later and decodes no slower, so it finishes first at every output length.`;
  }
  const tokens = Math.round(result.crossoverTokens);
  const longform =
    result.longformVisibleTokens === null
      ? "no longform data"
      : `the longform task produced ${Math.round(result.longformVisibleTokens)} visible tokens`;
  const crosses =
    result.longformVisibleTokens !== null && result.longformVisibleTokens >= tokens
      ? " — the longform task clears this."
      : result.longformVisibleTokens !== null
        ? " — the longform task does not clear this."
        : "";
  return `- **${result.laterModel}** needs an output longer than **${tokens} tokens** to finish before **${result.earlierModel}**; ${longform}${crosses}`;
}

function crossoverSection(models: string[], cellsByEffort: Map<EffortLevel, Map<string, CellSummary>>): string {
  const defaultCells = cellsByEffort.get("default");
  const intro = [
    "## Crossover: does the faster decoder actually win?",
    "",
    "For each candidate against `gpt-5.6-luna`, the output length (in visible",
    "tokens) beyond which a later-starting, faster-decoding model overtakes the",
    "earlier-starting one — derived from each model's `default`-effort median",
    "TTFT and decode rate. `crossover_tokens = (ttft_B - ttft_A) / (1/rate_A -",
    "1/rate_B)`, where A is the later-starting/faster-decoding model.",
    "",
  ];
  if (!defaultCells) {
    return [...intro, "n/a — `default` effort was not part of this run."].join("\n");
  }
  const baselineCell = defaultCells.get(BASELINE_MODEL);
  const lines = models
    .filter((m) => m !== BASELINE_MODEL)
    .map((m) => crossoverLine(m, crossoverOf(m, defaultCells.get(m), baselineCell)));
  if (lines.length === 0) {
    lines.push(`n/a — ${BASELINE_MODEL} is the only model in this run.`);
  }
  return [...intro, ...lines].join("\n");
}

// ── formatting ────────────────────────────────────────────────────────────────

const MISSING = "—";

function ms(value: number | null): string {
  return value === null ? MISSING : `${Math.round(value)}ms`;
}

function tokPerSec(value: number | null): string {
  return value === null ? MISSING : `${value.toFixed(1)} tok/s`;
}

function ratio(value: number | null): string {
  return value === null ? MISSING : value.toFixed(2);
}

function intOrMissing(value: number | null): string {
  return value === null ? MISSING : `${Math.round(value)}`;
}

function moneyPerRun(cell: CellSummary): string {
  if (!cell.supported) return MISSING;
  if (cell.costNote === "no-rate") return "no rate";
  if (cell.costNote === "unpriced") return "unpriced";
  if (cell.costPerRun === null) return MISSING;
  return cell.costNote === "partial" ? `~$${cell.costPerRun.toFixed(6)}` : `$${cell.costPerRun.toFixed(6)}`;
}

function passLabel(cell: CellSummary): string {
  if (!cell.supported) return MISSING;
  if (cell.majorityStarved) return "starved";
  return `${cell.taskPassCount}/${cell.taskCount}`;
}

function starvedLabel(cell: CellSummary): string {
  if (!cell.supported || cell.starvedCalls === null || cell.attemptedCalls === null) return MISSING;
  return `${cell.starvedCalls}/${cell.attemptedCalls}`;
}

function timedLabel(cell: CellSummary): string {
  if (!cell.supported) return MISSING;
  return `${cell.timingRows}/${cell.timingRowsTotal}`;
}

function passRateLabel(cell: CellSummary): string {
  if (!cell.supported) return MISSING;
  if (cell.majorityStarved) return "starved";
  if (cell.gradedCalls === null || cell.passedCalls === null || cell.gradedCalls === 0) return MISSING;
  return `${cell.passedCalls}/${cell.gradedCalls} (${Math.round((cell.passedCalls / cell.gradedCalls) * 100)}%)`;
}

function verdictLabel(cell: CellSummary, verdict: Verdict): string {
  return cell.supported ? verdict : "unsupported";
}

function thinkVisibleLabel(cell: CellSummary, unreliableModels: Set<string>): string {
  if (!cell.supported) return MISSING;
  if (unreliableModels.has(cell.model)) return "unreliable";
  return ratio(cell.thinkVisibleRatio);
}

function thinkingSpreadLabel(cell: CellSummary, unreliableModels: Set<string>): string {
  if (!cell.supported) return MISSING;
  if (unreliableModels.has(cell.model)) return "unreliable";
  return intOrMissing(cell.thinkingSpread);
}

// ── report ───────────────────────────────────────────────────────────────────

function headlineTable(
  cells: CellSummary[],
  verdicts: Map<string, Verdict>,
  unreliableModels: Set<string>,
): string {
  const supported = cells
    .filter((c) => c.supported)
    .toSorted((a, b) => {
      const wa = a.medianWallMs ?? Number.POSITIVE_INFINITY;
      const wb = b.medianWallMs ?? Number.POSITIVE_INFINITY;
      return wa - wb;
    });
  const unsupported = cells.filter((c) => !c.supported);
  const ordered = [...supported, ...unsupported];

  const rows = ordered.map((c) => {
    const verdict = verdictLabel(c, verdicts.get(c.model) ?? "unsupported");
    return (
      `| ${c.model} | ${c.effort} | ${passLabel(c)} | ${starvedLabel(c)} | ${timedLabel(c)} | ` +
      `${ms(c.medianWallMs)} | ${ms(c.medianTtftMs)} | ${ms(c.medianThinkMs)} | ${tokPerSec(c.decodeTokPerSec)} | ` +
      `${intOrMissing(c.medianCompletionTokens)} | ${thinkingSpreadLabel(c, unreliableModels)} | ` +
      `${thinkVisibleLabel(c, unreliableModels)} | ${moneyPerRun(c)} | ${verdict} |`
    );
  });

  return [
    "| model | effort | pass | starved | timed | median wall | median ttft | median think | decode tok/s | completion tok | think spread | think:visible | $/run | verdict |",
    "|-|-|-|-|-|-|-|-|-|-|-|-|-|-|",
    ...rows,
  ].join("\n");
}

function effortCurveSection(models: string[], cells: CellSummary[], unreliableModels: Set<string>): string {
  const byModel = new Map<string, CellSummary[]>();
  for (const cell of cells) {
    const list = byModel.get(cell.model) ?? [];
    list.push(cell);
    byModel.set(cell.model, list);
  }
  return models
    .map((model) => {
      const modelCells = (byModel.get(model) ?? []).toSorted(
        (a, b) => ALL_EFFORTS.indexOf(a.effort) - ALL_EFFORTS.indexOf(b.effort),
      );
      const unreliable = unreliableModels.has(model);
      const rows = modelCells.map(
        (c) =>
          `| ${c.effort} | ${passRateLabel(c)} | ${starvedLabel(c)} | ${ms(c.medianWallMs)} | ` +
          `${intOrMissing(c.medianCompletionTokens)} | ${thinkingSpreadLabel(c, unreliableModels)} |`,
      );
      return [
        `### ${model}${unreliable ? " — reasoning-token accounting unreliable (see caveats)" : ""}`,
        "",
        "| effort | pass rate | starved | median wall | completion tok | thinking spread |",
        "|-|-|-|-|-|-|",
        ...rows,
      ].join("\n");
    })
    .join("\n\n");
}

const CAVEATS = [
  "## What this does and does not measure",
  "",
  "This measures **operational fitness and cost-of-correctness** on five narrow,",
  "deterministic tasks (structured extraction, arithmetic word-problem reasoning,",
  "single-label classification, multi-constraint instruction-following, and a",
  "~1200-word longform explanation) across a model's `reasoning_effort` ladder.",
  "A passing cell means the task floor was cleared at that effort level, in this",
  "many repeats — it is not a general intelligence benchmark, and it says",
  "nothing about capability on harder tasks. The headline number is median",
  "**wall time to a correct answer**, not time-to-first-token: a model that",
  "starts late and decodes fast can still win, and this is the harness built to",
  "see that.",
  "",
  "**`starved`** means the call hit its token cap (`finish_reason: \"length\"`)",
  "having produced zero visible tokens — it spent the whole budget on hidden",
  "reasoning and never got to answer. That is a budget failure, not a wrong",
  "answer: starved calls are counted separately (the `starved` column) and",
  "excluded from the pass rate, and a cell where they are the majority reports",
  "`starved` in place of a pass fraction rather than a misleadingly low score.",
  "",
  "**`unreliable`** in the think:visible / thinking-spread columns means the",
  "model's reported `reasoning_tokens` value looked like a fixed constant across",
  "a spread of tasks with very different token budgets — a route-level reporting",
  "artifact, not a real measurement — so it is named rather than shown as a",
  "number that would misrepresent the model.",
  "",
  "**Pass rate at `--repeat 3` is a sample, not a fixed capability.** A model",
  "whose thinking expands or contracts run to run at the same effort level and",
  "cap (visible in a wide `thinking spread`) can flip between pass and fail on",
  "an identical prompt purely from that variance — read a middling pass rate as",
  "noise at this repeat count, not as a stable score.",
].join("\n");

function buildReport(input: {
  generatedAt: string;
  models: string[];
  efforts: EffortLevel[];
  tasks: FastTask[];
  repeats: number;
  cells: CellSummary[];
  cellsByEffort: Map<EffortLevel, Map<string, CellSummary>>;
  verdicts: Map<string, Verdict>;
  unreliableModels: Set<string>;
}): string {
  const { generatedAt, models, tasks, repeats, cells, cellsByEffort, verdicts, unreliableModels } = input;
  return [
    "# bench-fast report",
    "",
    `Generated ${generatedAt}. Models: ${models.join(", ")}. Tasks: ${tasks.map((t) => t.id).join(", ")}. Repeats: ${repeats}.`,
    "",
    crossoverSection(models, cellsByEffort),
    "",
    "## Headline",
    "",
    headlineTable(cells, verdicts, unreliableModels),
    "",
    "## Per-model effort curve",
    "",
    effortCurveSection(models, cells, unreliableModels),
    "",
    CAVEATS,
    "",
  ].join("\n");
}

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
const repeats = Math.max(1, Number(flagValue("repeat") ?? 3));
const concurrency = Math.max(1, Number(flagValue("concurrency") ?? 3));

function parseModels(): string[] {
  const raw = listValue("models");
  return raw.length > 0 ? raw : [...CANDIDATE_MODELS];
}

function parseEfforts(): EffortLevel[] {
  const raw = listValue("efforts");
  if (raw.length === 0) return [...ALL_EFFORTS];
  return raw.map((e) => {
    if (!ALL_EFFORTS.includes(e as EffortLevel)) {
      throw new Error(`unknown effort "${e}" — known: ${ALL_EFFORTS.join(", ")}`);
    }
    return e as EffortLevel;
  });
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

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const models = parseModels();
  const efforts = parseEfforts();
  const tasks = getFastTasks(listValue("tasks").length > 0 ? listValue("tasks") : undefined);

  const totalCalls = models.length * efforts.length * tasks.length * repeats;
  console.log(
    `bench-fast${dryRun ? " (dry run)" : ""}: ${models.length} model(s) x ${efforts.length} effort(s) x ` +
      `${tasks.length} task(s) x ${repeats} repeat(s) = ${totalCalls} call(s) upper bound, concurrency ${concurrency} across models.`,
  );
  console.log(`  models:  ${models.join(", ")}`);
  console.log(`  efforts: ${efforts.join(", ")}`);
  console.log(`  tasks:   ${tasks.map((t) => `${t.id} (cap ${t.maxTokens})`).join(", ")}`);

  if (dryRun) {
    console.log("\nDry run — nothing called, nothing spent.");
    await client.end();
    return;
  }

  const rates = await loadRates(models);
  const missingRates = models.filter((m) => !rates.has(m));
  if (missingRates.length > 0) {
    console.log(`  no price_in/price_out in metric_snapshot for: ${missingRates.join(", ")} — cost will read "no rate"`);
  }

  const perModel = await mapPool(models, concurrency, async (model) => {
    const hasRate = rates.has(model);
    const cells: CellSummary[] = [];
    const allRows: CallRow[] = [];
    for (const effort of efforts) {
      const result = await runCell(model, effort, tasks, repeats, rates.get(model));
      allRows.push(...result.rows);
      cells.push(summarizeCell(result, tasks.length, hasRate));
    }
    return { model, cells, reasoningUnreliable: reasoningLooksConstant(allRows) };
  });

  const cells = perModel.flatMap((p) => p.cells);
  const unreliableModels = new Set(perModel.filter((p) => p.reasoningUnreliable).map((p) => p.model));
  if (unreliableModels.size > 0) {
    console.log(
      `  reasoning-token accounting looks unreliable (constant across tasks/efforts) for: ${[...unreliableModels].join(", ")}`,
    );
  }

  const verdicts = new Map<string, Verdict>();
  for (const model of models) {
    verdicts.set(
      model,
      unreliableModels.has(model) ? "unreliable" : modelVerdict(cells.filter((c) => c.model === model)),
    );
  }

  const cellsByEffort = new Map<EffortLevel, Map<string, CellSummary>>();
  for (const cell of cells) {
    const byModel = cellsByEffort.get(cell.effort) ?? new Map<string, CellSummary>();
    byModel.set(cell.model, cell);
    cellsByEffort.set(cell.effort, byModel);
  }

  const generatedAt = new Date().toISOString();
  const report = buildReport({
    generatedAt,
    models,
    efforts,
    tasks,
    repeats,
    cells,
    cellsByEffort,
    verdicts,
    unreliableModels,
  });
  console.log(`\n${report}`);

  const metricRows: MetricRow[] = [];
  for (const cell of cells) {
    if (!cell.supported) continue;
    const conditions = conditionsFor(cell.effort);
    const reliable = !unreliableModels.has(cell.model);
    const push = (metric: string, value: number | null): void => {
      if (value === null) return;
      metricRows.push({ model_id: cell.model, source: "live", conditions, metric, value, confidence: 0.85 });
    };
    push("fast_wall_ms", cell.medianWallMs);
    push("fast_ttfb_ms", cell.medianTtfbMs);
    push("fast_ttft_ms", cell.medianTtftMs);
    push("fast_think_ms", cell.medianThinkMs);
    push("fast_throughput", cell.decodeTokPerSec);
    push("fast_completion_tokens_median", cell.medianCompletionTokens);
    // Reasoning-derived metrics are meaningless for a model whose reported
    // reasoning_tokens value is a route-level constant — never persist them.
    if (reliable) {
      push("fast_think_visible_ratio", cell.thinkVisibleRatio);
      push("fast_thinking_spread", cell.thinkingSpread);
    }
    if (cell.costPerRun !== null) push("fast_cost_usd_per_run", cell.costPerRun);
    if (cell.gradedCalls !== null && cell.passedCalls !== null && cell.gradedCalls > 0) {
      push("fast_pass_rate", cell.passedCalls / cell.gradedCalls);
    }
    if (cell.attemptedCalls !== null && cell.starvedCalls !== null && cell.attemptedCalls > 0) {
      push("fast_starved_rate", cell.starvedCalls / cell.attemptedCalls);
    }
  }
  await recordMetrics(metricRows);

  const reportDir = path.join(repoRoot(), "docs/experiments", `fast-${generatedAt.slice(0, 10)}`);
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
