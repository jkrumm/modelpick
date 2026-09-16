/**
 * Head-to-head bake-off between two candidates on the live IU endpoint, across
 * both transports IU exposes for them: the OpenAI-compatible `/openai/v1` route
 * and Google's native `/gemini/v1beta` route.
 *
 *   bun run scripts/benchmark-bakeoff.ts [suite]
 *     suite: all (default) | throughput | cache | tools | routing
 *
 * Unlike benchmark-throughput.ts (OpenAI-compat only, decode speed only) this
 * measures the full economics of a turn: TTFT, decode rate, *hidden* reasoning
 * tokens, prompt-cache reporting, per-turn cost, and backend routing headers —
 * the things that decide whether a model is actually cheaper/faster in an agent
 * loop rather than on a leaderboard.
 *
 * Results are printed and written to metric_snapshot (source: "live").
 */
import { db, client } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";
import type { Thinking } from "../src/db/schema.js";

type MetricRow = typeof metricSnapshot.$inferInsert;

/**
 * The reasoning configuration a candidate was measured under, stamped onto every
 * live metric row. Without it a TTFT recorded with thinking suppressed sits in
 * the same column as one recorded at default effort and outranks it — which is
 * how gpt-5.6-luna was once read as categorically faster than it is
 * (docs/decisions/hermes-brain.md, 2026-09-11).
 */
function conditionsOf(candidate: Candidate): Thinking {
  const effort = candidate.extra?.["reasoning_effort"];
  if (effort === "none") return "off";
  if (
    effort === "minimal" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "max"
  ) {
    return effort;
  }
  return "default";
}

/** Models not yet in the catalog fail the FK — don't lose a live run over it. */
async function recordMetrics(rows: MetricRow[]): Promise<void> {
  try {
    await db.insert(metricSnapshot).values(rows);
  } catch (err) {
    console.log(`  (metric_snapshot skipped: ${err instanceof Error ? err.message : String(err)})`);
  }
}

type Transport = "openai" | "gemini";

interface Candidate {
  id: string;
  label: string;
  transport: Transport;
  /** USD per 1M tokens; used for the cost column. */
  rate: { input: number; output: number; cachedInput: number | null };
  /**
   * Transport-specific request fields merged into every call — the reasoning
   * controls live here, since suppressing thinking is the single biggest lever
   * on both TTFT and billed output on the Gemini side.
   */
  extra?: Record<string, unknown>;
}

/**
 * Vendor list prices per 1M tokens, NOT IU's confirmed billed rate (IU publishes
 * none and no longer returns a `cost` field on any route). Both vendors bill
 * reasoning/thinking tokens at the output rate.
 *   Luna: OpenAI/Azure post-2026-07-30 price cut, short context (<=272k).
 */
const LUNA_RATE = { input: 0.2, output: 1.2, cachedInput: 0.02 };
/**
 * DeepSeek V4.1 Flash list price per AA (2026-09-11). IU reaches it through
 * Requesty, which forwards to Fireworks — so this is the model vendor's rate,
 * not a confirmed IU billing rate. The route *reports* `cached_tokens` (3,046 of
 * 3,175 on the cache suite) but publishes no discounted cached-input rate, so
 * `cachedInput: null` bills a cache hit at the full input price — which is why
 * its per-call cost stays flat across identical-prefix calls while Luna's drops 9x.
 */
const DEEPSEEK_FLASH_RATE = { input: 0.3, output: 1.2, cachedInput: null };

const GLM_FLASH_RATE = { input: 0.15, output: 0.5, cachedInput: 0.03 };

const CANDIDATES: Candidate[] = [
  {
    id: "glm-5.3-flash",
    label: "GLM 5.3 Flash, reasoning_effort=high",
    transport: "openai",
    rate: GLM_FLASH_RATE,
    // `high`, not the `max` default: max spends 56x the reasoning for no better output and
    // starves at a normal budget (docs/decisions/model-configs.md). `medium` is rejected.
    extra: { reasoning_effort: "high" },
  },
  {
    id: "gpt-5.6-luna",
    label: "Luna, default effort",
    transport: "openai",
    rate: LUNA_RATE,
  },
  {
    id: "gpt-5.6-luna",
    label: "Luna, reasoning_effort=none",
    transport: "openai",
    rate: LUNA_RATE,
    extra: { reasoning_effort: "none" },
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash, default effort",
    transport: "openai",
    rate: DEEPSEEK_FLASH_RATE,
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash, reasoning_effort=low",
    transport: "openai",
    rate: DEEPSEEK_FLASH_RATE,
    extra: { reasoning_effort: "low" },
  },
];

const TURNS = [
  "Write a ~250 word technical explanation of how TCP congestion control works.",
  "Now rewrite that same explanation for a complete beginner, same length.",
  "Now summarize the key trade-offs as 5 bullet points.",
];

// Gemini 3 counts thinking tokens against maxOutputTokens, so a 600-token cap
// spends the whole budget on thoughts and truncates the answer. Give both models
// enough headroom to finish naturally.
// Raised from 4000 on 2026-09-12. The previous tool-suite verdict (luna 6.6s vs V4.1 21.4s)
// was taken at 4000, which is inside the budget-starvation zone that invalidated the
// fast-model conclusions — a model that spends its whole allowance thinking looks like a
// model that failed the task. 16000 is above every measured thinking spend in the field.
const MAX_TOKENS = 16000;
const TIMEOUT_MS = 90_000;

interface Usage {
  promptTokens: number;
  visibleTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

interface TurnResult extends Usage {
  ttfbMs: number | null;
  ttftMs: number | null;
  thinkMs: number;
  decodeMs: number;
  wallMs: number;
  tokensPerSec: number | null;
  text: string;
  backend: string;
  finishReason: string;
}

const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  visibleTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function costUsd(candidate: Candidate, usage: Usage): number {
  const { rate } = candidate;
  const fresh = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const cachedRate = rate.cachedInput ?? rate.input;
  // Reasoning tokens bill as output even when the API omits them from the
  // visible completion count.
  const out = usage.visibleTokens + usage.reasoningTokens;
  return (
    (fresh * rate.input + usage.cachedTokens * cachedRate + out * rate.output) / 1_000_000
  );
}

/** Message shape is transport-specific; the caller owns history in native form. */
type OpenAiMessage = { role: string; content: string | null; [key: string]: unknown };
type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };

async function readSse(
  resp: Response,
  onEvent: (parsed: unknown) => void,
): Promise<void> {
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

async function streamOpenAi(
  model: string,
  messages: OpenAiMessage[],
  extra?: Record<string, unknown>,
): Promise<TurnResult> {
  const start = performance.now();
  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let text = "";
  let finishReason = "?";
  const usage: Usage = { ...EMPTY_USAGE };

  const resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("IU_API_KEY")}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      ...extra,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const backend = resp.headers.get("x-middleware-forwarded-server") ?? "?";

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
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    // Any parsed data: frame counts toward ttfb, including reasoning-only
    // deltas (delta.reasoning_content / delta.reasoning) — the point is
    // separating transport latency from the model's thinking phase, not just
    // measuring time to visible text.
    firstFrameAt ??= performance.now();
    if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) {
      firstTokenAt ??= performance.now();
      text += delta;
    }
    if (parsed.usage) {
      const promptTokens = parsed.usage.prompt_tokens ?? 0;
      const completionTokens = parsed.usage.completion_tokens ?? 0;
      const totalTokens = parsed.usage.total_tokens ?? 0;
      usage.promptTokens = promptTokens;
      usage.totalTokens = totalTokens;
      usage.cachedTokens = parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;
      /**
       * IU's OpenAI-compat route reports usage in exactly two shapes (measured
       * live, 2026-09-11):
       *
       *  1. Azure OpenAI ids (gpt-5.6-luna) and Requesty-proxied ids
       *     (deepseek-v4.1-flash, glm-5.3-flash, DeepSeek-V4-Pro):
       *     `completion_tokens` ALREADY INCLUDES
       *     `completion_tokens_details.reasoning_tokens`, and
       *     `total_tokens === prompt_tokens + completion_tokens`.
       *     Measured: prompt 44, completion 629, reasoning 314, total 673.
       *
       *  2. Gemini ids served through this same route (gemini-3.8-flash):
       *     `completion_tokens` EXCLUDES thinking and `reasoning_tokens` is
       *     absent/0, while `total_tokens` counts it.
       *     Measured: prompt 17, completion 384, reasoning 0, total 1479 —
       *     1,078 hidden thinking tokens `completion_tokens` never mentions.
       *
       * Adding a reasoning figure on top of `completion_tokens` therefore
       * double-bills reasoning under shape 1 (it's already inside
       * `completion_tokens`). `billedOutput = max(completion_tokens,
       * total_tokens - prompt_tokens)` is the shape-agnostic total: under
       * shape 1 it collapses to `completion_tokens` (total - prompt ==
       * completion by definition); under shape 2 it recovers the true total
       * including the hidden thinking. Subtracting the reasoning figure back
       * out of that gives the true visible count under either shape.
       */
      const reported = parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0;
      const hidden = Math.max(0, totalTokens - promptTokens - completionTokens);
      const reasoning = reported > 0 ? reported : hidden;
      const billedOutput = Math.max(completionTokens, totalTokens - promptTokens);
      usage.reasoningTokens = reasoning;
      usage.visibleTokens = Math.max(0, billedOutput - reasoning);
    }
  });

  return finishTurn({ start, firstFrameAt, firstTokenAt, text, usage, backend, finishReason });
}

async function streamGeminiNative(
  model: string,
  contents: GeminiContent[],
  extra?: Record<string, unknown>,
): Promise<TurnResult> {
  const start = performance.now();
  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let text = "";
  let finishReason = "?";
  const usage: Usage = { ...EMPTY_USAGE };

  const url = `${env("IU_GEMINI_BASE_URL")}/models/${model}:streamGenerateContent?alt=sse`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env("IU_API_KEY") },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: MAX_TOKENS, ...extra },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const backend = resp.headers.get("x-middleware-forwarded-server") ?? "?";

  await readSse(resp, (event) => {
    const parsed = event as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        cachedContentTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    // A part with `thought: true` is a frame (counts toward ttfb) but not
    // visible text (does not count toward ttft) — same split as the OpenAI
    // reasoning-delta case in streamOpenAi() above.
    firstFrameAt ??= performance.now();
    if (parsed.candidates?.[0]?.finishReason) finishReason = parsed.candidates[0].finishReason;
    for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (part.thought) continue;
      if (typeof part.text === "string" && part.text.length > 0) {
        firstTokenAt ??= performance.now();
        text += part.text;
      }
    }
    const meta = parsed.usageMetadata;
    if (meta) {
      usage.promptTokens = meta.promptTokenCount ?? usage.promptTokens;
      usage.visibleTokens = meta.candidatesTokenCount ?? usage.visibleTokens;
      usage.reasoningTokens = meta.thoughtsTokenCount ?? usage.reasoningTokens;
      usage.cachedTokens = meta.cachedContentTokenCount ?? usage.cachedTokens;
      usage.totalTokens = meta.totalTokenCount ?? usage.totalTokens;
    }
  });

  return finishTurn({ start, firstFrameAt, firstTokenAt, text, usage, backend, finishReason });
}

function finishTurn(input: {
  start: number;
  firstFrameAt: number | null;
  firstTokenAt: number | null;
  text: string;
  usage: Usage;
  backend: string;
  finishReason: string;
}): TurnResult {
  const end = performance.now();
  const { start, firstFrameAt, firstTokenAt, text, usage, backend, finishReason } = input;
  const ttfbMs = firstFrameAt === null ? null : firstFrameAt - start;
  const ttftMs = firstTokenAt === null ? null : firstTokenAt - start;
  const thinkMs =
    firstFrameAt !== null && firstTokenAt !== null ? Math.max(0, firstTokenAt - firstFrameAt) : 0;
  const decodeMs = firstTokenAt === null ? end - start : end - firstTokenAt;
  const visible = usage.visibleTokens > 0 ? usage.visibleTokens : Math.round(text.length / 4);
  return {
    ...usage,
    visibleTokens: visible,
    ttfbMs,
    ttftMs,
    thinkMs,
    decodeMs,
    wallMs: end - start,
    tokensPerSec: decodeMs > 0 ? visible / (decodeMs / 1000) : null,
    text,
    backend,
    finishReason,
  };
}

async function runTurn(
  candidate: Candidate,
  history: { openai: OpenAiMessage[]; gemini: GeminiContent[] },
  prompt: string,
): Promise<TurnResult> {
  if (candidate.transport === "openai") {
    history.openai.push({ role: "user", content: prompt });
    const result = await streamOpenAi(candidate.id, history.openai, candidate.extra);
    history.openai.push({ role: "assistant", content: result.text });
    return result;
  }
  history.gemini.push({ role: "user", parts: [{ text: prompt }] });
  const result = await streamGeminiNative(candidate.id, history.gemini, candidate.extra);
  history.gemini.push({ role: "model", parts: [{ text: result.text }] });
  return result;
}

async function suiteThroughput(): Promise<void> {
  console.log("\n########## THROUGHPUT / TTFT / TOKEN ACCOUNTING ##########");
  for (const candidate of CANDIDATES) {
    console.log(`\n=== ${candidate.label} [${candidate.id}] ===`);
    const history = { openai: [] as OpenAiMessage[], gemini: [] as GeminiContent[] };
    const turns: TurnResult[] = [];

    for (const [i, prompt] of TURNS.entries()) {
      try {
        const result = await runTurn(candidate, history, prompt);
        turns.push(result);
        console.log(
          `  turn ${i + 1}: ttfb ${result.ttfbMs?.toFixed(0) ?? "—"}ms · think ${result.thinkMs.toFixed(0)}ms · ttft ${result.ttftMs?.toFixed(0) ?? "—"}ms · ` +
            `${result.tokensPerSec?.toFixed(1) ?? "—"} tok/s · ` +
            `in ${result.promptTokens} (cached ${result.cachedTokens}) · ` +
            `out ${result.visibleTokens} + think ${result.reasoningTokens} · ` +
            `wall ${(result.wallMs / 1000).toFixed(1)}s · $${costUsd(candidate, result).toFixed(6)} · ${result.finishReason}`,
        );
      } catch (err) {
        console.log(`  turn ${i + 1}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (turns.length === 0) continue;

    const avg = (pick: (t: TurnResult) => number | null): number => {
      const values = turns.map(pick).filter((v): v is number => v !== null);
      return values.reduce((s, v) => s + v, 0) / (values.length || 1);
    };
    const totalCost = turns.reduce((s, t) => s + costUsd(candidate, t), 0);
    const totalWall = turns.reduce((s, t) => s + t.wallMs, 0);
    console.log(
      `  AVG: ttfb ${avg((t) => t.ttfbMs).toFixed(0)}ms · think ${avg((t) => t.thinkMs).toFixed(0)}ms · ttft ${avg((t) => t.ttftMs).toFixed(0)}ms · ${avg((t) => t.tokensPerSec).toFixed(1)} tok/s · ` +
        `think/visible ratio ${(avg((t) => t.reasoningTokens) / Math.max(1, avg((t) => t.visibleTokens))).toFixed(2)} · ` +
        `conversation ${(totalWall / 1000).toFixed(1)}s · $${totalCost.toFixed(5)} · backend "${turns[0]?.backend}"`,
    );

    await recordMetrics([
      {
        model_id: candidate.id,
        source: "live",
        conditions: conditionsOf(candidate),
        metric: "throughput",
        value: avg((t) => t.tokensPerSec),
        confidence: 0.9,
      },
      {
        model_id: candidate.id,
        source: "live",
        conditions: conditionsOf(candidate),
        metric: "ttft_ms",
        value: avg((t) => t.ttftMs),
        confidence: 0.9,
      },
      {
        model_id: candidate.id,
        source: "live",
        conditions: conditionsOf(candidate),
        metric: "ttfb_ms",
        value: avg((t) => t.ttfbMs),
        confidence: 0.9,
      },
    ]);
  }
}

// 600 rules ~= 30k tokens. Sized deliberately: the 60-rule (~3.1k token) version answered
// "does caching work at all", which is a different question from "does caching decide a brain".
// Hermes runs `context_length: 850000` and compacts at 240k, so a real turn re-sends tens of
// thousands of tokens of prefix — the regime where a cached-input rate either dominates the
// bill or does not exist. Override with CACHE_PREFIX_RULES.
const CACHE_PREFIX_RULES = Number(process.env["CACHE_PREFIX_RULES"] ?? 600);

const CACHE_PREFIX = [
  "You are an operations assistant for a personal infrastructure stack.",
  ...Array.from(
    { length: CACHE_PREFIX_RULES },
    (_, i) =>
      `Rule ${i + 1}: service-${i + 1} runs on port ${7000 + i} behind the reverse proxy, ` +
      `is health-checked every ${30 + i} seconds, restarts on failure with a ${i + 2}x backoff, ` +
      `and logs to the central collector under the tag ops-${i + 1}.`,
  ),
].join("\n");

async function suiteCache(): Promise<void> {
  console.log("\n########## PROMPT CACHE (identical prefix, 3 calls) ##########");
  for (const candidate of CANDIDATES) {
    console.log(`\n=== ${candidate.label} [${candidate.id}] ===`);
    for (let call = 1; call <= 3; call++) {
      try {
        const prompt = "Which port does service-42 use? Answer with just the number.";
        const result =
          candidate.transport === "openai"
            ? await streamOpenAi(
                candidate.id,
                [
                  { role: "system", content: CACHE_PREFIX },
                  { role: "user", content: prompt },
                ],
                candidate.extra,
              )
            : await streamGeminiNative(
                candidate.id,
                [{ role: "user", parts: [{ text: `${CACHE_PREFIX}\n\n${prompt}` }] }],
                candidate.extra,
              );
        console.log(
          `  call ${call}: in ${result.promptTokens} · cached ${result.cachedTokens} · ` +
            `out ${result.visibleTokens} + think ${result.reasoningTokens} · ` +
            `wall ${result.wallMs.toFixed(0)}ms · $${costUsd(candidate, result).toFixed(6)} · ` +
            `answer "${result.text.trim().slice(0, 40)}"`,
        );
      } catch (err) {
        console.log(`  call ${call}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// --- tool-calling scenario (same 3-tool script as benchmark-tool-calling.ts) ---

const EXPECTED_TOOLS = ["get_weather", "create_task", "search_notes"] as const;

const TOOL_SCHEMAS = [
  {
    name: "get_weather",
    description: "Get current weather conditions for a location",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  },
  {
    name: "create_task",
    description: "Create a task/reminder",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string", description: "ISO date" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title", "due_date", "priority"],
    },
  },
  {
    name: "search_notes",
    description: "Search the user's personal notes",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
];

const SYSTEM_PROMPT =
  "You are a personal assistant with access to tools. Use tools whenever they " +
  "would help answer accurately — don't guess or skip a tool that's clearly relevant.";

const USER_PROMPT =
  "Check the weather in Berlin right now. If it looks like rain, create a task " +
  "titled 'Bring umbrella' due tomorrow with high priority. Also search my notes " +
  "for 'umbrella brand recommendations' and tell me if you find anything useful.";

const FAKE_TOOL_RESULTS: Record<string, Record<string, unknown>> = {
  get_weather: { condition: "rain", temp_c: 14, chance_of_rain_pct: 80 },
  create_task: { status: "created", task_id: "t_9231" },
  search_notes: {
    results: [{ title: "Umbrella brands worth buying", snippet: "Blunt and Senz hold up in wind." }],
  },
};

const MAX_ROUNDS = 6;

// Gemini 3 bills thinking against maxOutputTokens (same trap as MAX_TOKENS above).
// At 500 a thinking-heavy round burns the whole budget on thoughts and returns an
// empty candidate — which this harness scores as "dropped a tool / did not finish",
// i.e. a truncation artifact indistinguishable from a real capability failure.
// Raised from 4000 on 2026-09-12, same reason as MAX_TOKENS above: the standing
// "luna 6.6s vs V4.1 21.4s on 3 tools" verdict was measured at this cap, and a model whose
// thinking expands to fill the budget (deepseek-v4.1-flash: ~7,970 tokens per cell) cannot
// reach the tool calls at all inside it. That is starvation, not a tool-calling failure.
const TOOL_MAX_TOKENS = 16000;

interface ToolRunResult {
  rounds: number;
  called: string[];
  argsValid: number;
  argsTotal: number;
  finished: boolean;
  totalMs: number;
  promptTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  error: string | null;
}

async function toolRunOpenAi(candidate: Candidate): Promise<ToolRunResult> {
  const messages: OpenAiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: USER_PROMPT },
  ];
  const called: string[] = [];
  let argsValid = 0;
  let argsTotal = 0;
  const tally = { prompt: 0, output: 0, reasoning: 0 };
  const start = performance.now();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env("IU_API_KEY")}`,
      },
      body: JSON.stringify({
        model: candidate.id,
        messages,
        tools: TOOL_SCHEMAS.map((fn) => ({ type: "function", function: fn })),
        tool_choice: "auto",
        max_completion_tokens: TOOL_MAX_TOKENS,
        ...candidate.extra,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      return {
        rounds: round,
        called,
        argsValid,
        argsTotal,
        finished: false,
        totalMs: performance.now() - start,
        ...tallyToUsage(tally),
        error: `HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}`,
      };
    }
    const body = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
            /** Gemini-on-OpenAI-compat thought signature; must survive the round-trip. */
            extra_content?: unknown;
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    // Same shape-agnostic correction as streamOpenAi() above: completion_tokens
    // already includes reasoning under the Azure/Requesty shape, so tallying
    // both separately would double-bill it.
    const roundPrompt = body.usage?.prompt_tokens ?? 0;
    const roundCompletion = body.usage?.completion_tokens ?? 0;
    const roundTotal = body.usage?.total_tokens ?? 0;
    const reported = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const hidden = Math.max(0, roundTotal - roundPrompt - roundCompletion);
    const roundReasoning = reported > 0 ? reported : hidden;
    const roundBilledOutput = Math.max(roundCompletion, roundTotal - roundPrompt);
    tally.prompt += roundPrompt;
    tally.output += Math.max(0, roundBilledOutput - roundReasoning);
    tally.reasoning += roundReasoning;

    const message = body.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        rounds: round + 1,
        called,
        argsValid,
        argsTotal,
        finished: (message?.content ?? "").length > 0,
        totalMs: performance.now() - start,
        ...tallyToUsage(tally),
        error: null,
      };
    }
    // Echo the assistant turn back VERBATIM, same reason as the native path: on the
    // OpenAI-compat route Gemini smuggles its thought signature through
    // `tool_calls[].extra_content.google.thought_signature`. Rebuilding the message
    // from id/name/arguments drops it, and the next request 503s out of the LiteLLM
    // GDPR/Vertex gateway with an upstream 404 — which reads like "no EU deployment"
    // rather than the harness bug it is.
    messages.push({ ...message, role: "assistant", content: message?.content ?? null });
    for (const tc of toolCalls) {
      argsTotal++;
      try {
        JSON.parse(tc.function.arguments);
        argsValid++;
      } catch {
        // malformed args counted below
      }
      called.push(tc.function.name);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(FAKE_TOOL_RESULTS[tc.function.name] ?? { error: "unknown tool" }),
      });
    }
  }
  return {
    rounds: MAX_ROUNDS,
    called,
    argsValid,
    argsTotal,
    finished: false,
    totalMs: performance.now() - start,
    ...tallyToUsage(tally),
    error: "exceeded MAX_ROUNDS",
  };
}

function tallyToUsage(tally: { prompt: number; output: number; reasoning: number }): {
  promptTokens: number;
  outputTokens: number;
  reasoningTokens: number;
} {
  return {
    promptTokens: tally.prompt,
    outputTokens: tally.output,
    reasoningTokens: tally.reasoning,
  };
}

async function toolRunGeminiNative(candidate: Candidate): Promise<ToolRunResult> {
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: USER_PROMPT }] }];
  const called: string[] = [];
  let argsValid = 0;
  let argsTotal = 0;
  const tally = { prompt: 0, output: 0, reasoning: 0 };
  const start = performance.now();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const url = `${env("IU_GEMINI_BASE_URL")}/models/${candidate.id}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env("IU_API_KEY") },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        tools: [{ functionDeclarations: TOOL_SCHEMAS }],
        generationConfig: { maxOutputTokens: TOOL_MAX_TOKENS, ...candidate.extra },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      return {
        rounds: round,
        called,
        argsValid,
        argsTotal,
        finished: false,
        totalMs: performance.now() - start,
        ...tallyToUsage(tally),
        error: `HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}`,
      };
    }
    const body = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    tally.prompt += body.usageMetadata?.promptTokenCount ?? 0;
    tally.output += body.usageMetadata?.candidatesTokenCount ?? 0;
    tally.reasoning += body.usageMetadata?.thoughtsTokenCount ?? 0;

    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter(
      (p): p is { functionCall: { name: string; args: unknown } } =>
        typeof p["functionCall"] === "object" && p["functionCall"] !== null,
    );
    if (calls.length === 0) {
      const text = parts.map((p) => (typeof p["text"] === "string" ? p["text"] : "")).join("");
      return {
        rounds: round + 1,
        called,
        argsValid,
        argsTotal,
        finished: text.trim().length > 0,
        totalMs: performance.now() - start,
        ...tallyToUsage(tally),
        error: null,
      };
    }
    // Echo the model turn back verbatim so Gemini 3 thought signatures survive.
    contents.push({ role: "model", parts });
    const responseParts: GeminiPart[] = [];
    for (const call of calls) {
      argsTotal++;
      if (call.functionCall.args && typeof call.functionCall.args === "object") argsValid++;
      called.push(call.functionCall.name);
      responseParts.push({
        functionResponse: {
          name: call.functionCall.name,
          response: FAKE_TOOL_RESULTS[call.functionCall.name] ?? { error: "unknown tool" },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }
  return {
    rounds: MAX_ROUNDS,
    called,
    argsValid,
    argsTotal,
    finished: false,
    totalMs: performance.now() - start,
    ...tallyToUsage(tally),
    error: "exceeded MAX_ROUNDS",
  };
}

async function suiteTools(): Promise<void> {
  console.log("\n########## MULTI-STEP TOOL CALLING (3-tool scenario) ##########");
  for (const candidate of CANDIDATES) {
    console.log(`\n=== ${candidate.label} [${candidate.id}] ===`);
    try {
      const result =
        candidate.transport === "openai"
          ? await toolRunOpenAi(candidate)
          : await toolRunGeminiNative(candidate);
      const unique = new Set(result.called);
      const coverage = EXPECTED_TOOLS.filter((t) => unique.has(t)).length;
      const billedOut = result.outputTokens + result.reasoningTokens;
      const cost =
        (result.promptTokens * candidate.rate.input + billedOut * candidate.rate.output) / 1_000_000;
      console.log(
        `  rounds ${result.rounds} · tools [${[...unique].join(", ")}] ${coverage}/3 · ` +
          `args ${result.argsValid}/${result.argsTotal} valid · finished ${result.finished}` +
          (result.error ? ` · error ${result.error}` : ""),
      );
      console.log(
        `  total ${(result.totalMs / 1000).toFixed(1)}s · in ${result.promptTokens} · ` +
          `out ${result.outputTokens} + think ${result.reasoningTokens} · $${cost.toFixed(6)}`,
      );
      const success = coverage === 3 && result.argsValid === result.argsTotal && result.finished;
      await recordMetrics([
        {
          model_id: candidate.id,
          source: "live",
          conditions: conditionsOf(candidate),
          metric: "tool_call_success",
          value: success ? 1 : 0,
          confidence: 0.7,
        },
        {
          model_id: candidate.id,
          source: "live",
          conditions: conditionsOf(candidate),
          metric: "tool_call_coverage",
          value: coverage / 3,
          confidence: 0.7,
        },
      ]);
    } catch (err) {
      console.log(`  FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function suiteRouting(): Promise<void> {
  console.log("\n########## BACKEND ROUTING / RESIDENCY HEADERS ##########");
  const headerKeys = [
    "x-middleware-forwarded-server",
    "x-middleware-forwarded-model",
    "x-ms-region",
    "x-gemini-service-tier",
    "azureml-model-session",
  ];
  for (const candidate of CANDIDATES) {
    const resp =
      candidate.transport === "openai"
        ? await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env("IU_API_KEY")}`,
            },
            body: JSON.stringify({
              model: candidate.id,
              messages: [{ role: "user", content: "ping" }],
              max_completion_tokens: 8,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        : await fetch(`${env("IU_GEMINI_BASE_URL")}/models/${candidate.id}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env("IU_API_KEY") },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
    const found = headerKeys
      .map((k) => [k, resp.headers.get(k)] as const)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`);
    console.log(`\n=== ${candidate.label} === http ${resp.status}`);
    console.log(`  ${found.join(" · ") || "(no routing headers)"}`);
    await resp.text();
  }
}

const suite = process.argv[2] ?? "all";
if (suite === "all" || suite === "routing") await suiteRouting();
if (suite === "all" || suite === "throughput") await suiteThroughput();
if (suite === "all" || suite === "cache") await suiteCache();
if (suite === "all" || suite === "tools") await suiteTools();

await client.end();
