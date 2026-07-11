/**
 * Measures multi-step agentic tool-calling reliability against the live IU
 * endpoint — the thing that actually breaks a long Hermes-style agent loop,
 * not raw decode speed. Runs a scripted 3-tool scenario (weather → task →
 * notes search) with synthetic tool results fed back in, and checks whether
 * the model calls the right tools, with valid JSON args, and finishes with a
 * real answer instead of stalling or hallucinating past the tools.
 *
 *   bun run scripts/benchmark-tool-calling.ts [model-id ...]
 *
 * With no args, runs the default shortlist. Writes results to metric_snapshot
 * (source: "live", metric: "tool_call_success" / "tool_call_rounds").
 */
import { db, client } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";

interface Candidate {
  id: string;
  label: string;
}

const DEFAULT_CANDIDATES: Candidate[] = [
  { id: "DeepSeek-V4-Pro", label: "DeepSeek-V4-Pro" },
  { id: "DeepSeek-V4-Flash", label: "DeepSeek-V4-Flash" },
  { id: "GLM-5.2", label: "GLM-5.2" },
  { id: "Qwen3.7-Max", label: "Qwen3.7-Max" },
  { id: "minimax-m3", label: "MiniMax M3" },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
];

const EXPECTED_TOOLS = ["get_weather", "create_task", "search_notes"] as const;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather conditions for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "Search the user's personal notes",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
      },
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

const FAKE_TOOL_RESULTS: Record<string, string> = {
  get_weather: JSON.stringify({ condition: "rain", temp_c: 14, chance_of_rain_pct: 80 }),
  create_task: JSON.stringify({ status: "created", task_id: "t_9231" }),
  search_notes: JSON.stringify({
    results: [{ title: "Umbrella brands worth buying", snippet: "Blunt and Senz hold up in wind." }],
  }),
};

const MAX_ROUNDS = 6;
const TIMEOUT_MS = 60_000;

interface ToolCallSeen {
  name: string;
  argsValid: boolean;
}

interface RunResult {
  rounds: number;
  toolCalls: ToolCallSeen[];
  finished: boolean;
  finalText: string;
  totalMs: number;
  error: string | null;
}

async function chatOnce(
  model: string,
  messages: unknown[],
): Promise<{
  content: string | null;
  toolCalls: Array<{ id: string; name: string; args: string }>;
}> {
  const base = process.env["IU_OPENAI_BASE_URL"] ?? "";
  const key = process.env["IU_API_KEY"] ?? "";

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_completion_tokens: 500,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  }

  const body = (await resp.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const message = body.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: tc.function.arguments,
  }));
  return { content: message?.content ?? null, toolCalls };
}

async function runScenario(modelId: string): Promise<RunResult> {
  const messages: unknown[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: USER_PROMPT },
  ];
  const seen: ToolCallSeen[] = [];
  const start = performance.now();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let result: Awaited<ReturnType<typeof chatOnce>>;
    try {
      result = await chatOnce(modelId, messages);
    } catch (err) {
      return {
        rounds: round,
        toolCalls: seen,
        finished: false,
        finalText: "",
        totalMs: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (result.toolCalls.length === 0) {
      return {
        rounds: round + 1,
        toolCalls: seen,
        finished: (result.content ?? "").length > 0,
        finalText: result.content ?? "",
        totalMs: performance.now() - start,
        error: null,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content ?? null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.args },
      })),
    });

    for (const tc of result.toolCalls) {
      let argsValid = false;
      try {
        JSON.parse(tc.args);
        argsValid = true;
      } catch {
        argsValid = false;
      }
      seen.push({ name: tc.name, argsValid });
      const fakeResult = FAKE_TOOL_RESULTS[tc.name] ?? JSON.stringify({ error: "unknown tool" });
      messages.push({ role: "tool", tool_call_id: tc.id, content: fakeResult });
    }
  }

  return {
    rounds: MAX_ROUNDS,
    toolCalls: seen,
    finished: false,
    finalText: "",
    totalMs: performance.now() - start,
    error: "exceeded MAX_ROUNDS without a final answer",
  };
}

async function benchmarkModel(candidate: Candidate): Promise<void> {
  console.log(`\n=== ${candidate.label} (${candidate.id}) ===`);
  const result = await runScenario(candidate.id);

  if (result.error && result.toolCalls.length === 0) {
    console.log(`  FAILED — ${result.error}`);
    return;
  }

  const calledNames = new Set(result.toolCalls.map((tc) => tc.name));
  const expectedCalled = EXPECTED_TOOLS.filter((t) => calledNames.has(t)).length;
  const wellFormed = result.toolCalls.filter((tc) => tc.argsValid).length;
  const wellFormedPct = result.toolCalls.length > 0 ? wellFormed / result.toolCalls.length : 0;
  const coverage = expectedCalled / EXPECTED_TOOLS.length;

  console.log(`  rounds: ${result.rounds}, tool calls: ${result.toolCalls.length}`);
  console.log(
    `  called: [${[...calledNames].join(", ")}] — ${expectedCalled}/${EXPECTED_TOOLS.length} expected tools`,
  );
  console.log(`  well-formed args: ${wellFormed}/${result.toolCalls.length}`);
  console.log(`  finished with final answer: ${result.finished}${result.error ? ` (${result.error})` : ""}`);
  console.log(`  total: ${(result.totalMs / 1000).toFixed(1)}s`);

  // success = full expected-tool coverage, all args well-formed, and a real final answer
  const success = coverage === 1 && wellFormedPct === 1 && result.finished ? 1 : 0;

  await db.insert(metricSnapshot).values([
    {
      model_id: candidate.id,
      source: "live",
      metric: "tool_call_success",
      value: success,
      confidence: 0.7, // single scenario run — noisy, not a statistical average
    },
    {
      model_id: candidate.id,
      source: "live",
      metric: "tool_call_coverage",
      value: coverage,
      confidence: 0.7,
    },
    {
      model_id: candidate.id,
      source: "live",
      metric: "tool_call_rounds",
      value: result.rounds,
      confidence: 0.7,
    },
  ]);
}

const argModels = process.argv.slice(2);
const candidates =
  argModels.length > 0 ? argModels.map((id) => ({ id, label: id })) : DEFAULT_CANDIDATES;

console.log(`Running tool-calling scenario against ${candidates.length} model(s)...`);
for (const candidate of candidates) {
  await benchmarkModel(candidate);
}

await client.end();
