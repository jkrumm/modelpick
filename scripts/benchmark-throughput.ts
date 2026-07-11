/**
 * Measures real decode throughput + time-to-first-token against the live IU
 * endpoint for a shortlist of models, across a short multi-turn conversation.
 * External leaderboards (OpenRouter/ArtificialAnalysis) report throughput from
 * their own infra, not IU's — this is what Hermes (or Claude Code) actually
 * experiences hitting the IU gateway.
 *
 *   bun run scripts/benchmark-throughput.ts [model-id ...]
 *
 * With no args, runs the default shortlist. Writes results to metric_snapshot
 * (source: "live") so they show up alongside the leaderboard-sourced numbers.
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
];

const TURNS = [
  "Write a ~250 word technical explanation of how TCP congestion control works.",
  "Now rewrite that same explanation for a complete beginner, same length.",
  "Now summarize the key trade-offs as 5 bullet points.",
];

const MAX_TOKENS = 600;
const TIMEOUT_MS = 60_000;

interface TurnResult {
  ttftMs: number | null;
  decodeMs: number;
  tokens: number;
  tokensPerSec: number | null;
  tokensAreEstimated: boolean;
  text: string;
}

async function streamChat(
  model: string,
  messages: { role: string; content: string }[],
): Promise<TurnResult> {
  const base = process.env["IU_OPENAI_BASE_URL"] ?? "";
  const key = process.env["IU_API_KEY"] ?? "";
  const start = performance.now();
  let firstTokenAt: number | null = null;
  let completionTokens: number | null = null;
  let text = "";

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  }

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
      if (data === "[DONE]" || data === "") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { completion_tokens?: number };
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          text += delta;
        }
        if (parsed.usage?.completion_tokens) {
          completionTokens = parsed.usage.completion_tokens;
        }
      } catch {
        // partial/non-JSON SSE line — skip
      }
    }
  }

  const end = performance.now();
  const ttftMs = firstTokenAt !== null ? firstTokenAt - start : null;
  const decodeMs = firstTokenAt !== null ? end - firstTokenAt : end - start;
  const tokensAreEstimated = completionTokens === null;
  const tokens = completionTokens ?? Math.round(text.length / 4);
  const tokensPerSec = decodeMs > 0 ? tokens / (decodeMs / 1000) : null;

  return { ttftMs, decodeMs, tokens, tokensPerSec, tokensAreEstimated, text };
}

async function benchmarkModel(candidate: Candidate): Promise<void> {
  console.log(`\n=== ${candidate.label} (${candidate.id}) ===`);
  const history: { role: string; content: string }[] = [];
  const turnResults: TurnResult[] = [];

  for (const [i, prompt] of TURNS.entries()) {
    history.push({ role: "user", content: prompt });
    try {
      const result = await streamChat(candidate.id, history);
      history.push({ role: "assistant", content: result.text });
      turnResults.push(result);
      const estFlag = result.tokensAreEstimated ? " (est.)" : "";
      console.log(
        `  turn ${i + 1}: ttft ${result.ttftMs?.toFixed(0) ?? "—"}ms, ` +
          `${result.tokens} tok${estFlag}, ${result.tokensPerSec?.toFixed(1) ?? "—"} tok/s`,
      );
    } catch (err) {
      console.log(`  turn ${i + 1}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (turnResults.length === 0) {
    console.log(`  no successful turns — skipping metric_snapshot insert`);
    return;
  }

  const avgTtft =
    turnResults.filter((r) => r.ttftMs !== null).reduce((s, r) => s + (r.ttftMs ?? 0), 0) /
    turnResults.length;
  const avgThroughput =
    turnResults.filter((r) => r.tokensPerSec !== null).reduce((s, r) => s + (r.tokensPerSec ?? 0), 0) /
    turnResults.length;
  const anyEstimated = turnResults.some((r) => r.tokensAreEstimated);

  console.log(
    `  avg: ttft ${avgTtft.toFixed(0)}ms, ${avgThroughput.toFixed(1)} tok/s` +
      (anyEstimated ? " (token counts partly estimated)" : ""),
  );

  await db.insert(metricSnapshot).values([
    {
      model_id: candidate.id,
      source: "live",
      metric: "throughput",
      value: avgThroughput,
      confidence: anyEstimated ? 0.6 : 0.9,
    },
    {
      model_id: candidate.id,
      source: "live",
      metric: "ttft_ms",
      value: avgTtft,
      confidence: 0.9,
    },
  ]);
}

const argModels = process.argv.slice(2);
const candidates =
  argModels.length > 0 ? argModels.map((id) => ({ id, label: id })) : DEFAULT_CANDIDATES;

console.log(`Benchmarking ${candidates.length} model(s) against the live IU endpoint...`);
for (const candidate of candidates) {
  await benchmarkModel(candidate);
}

await client.end();
