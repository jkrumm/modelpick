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

/**
 * 4,000, not 600. Every reasoning model on this route bills thinking against the
 * same cap, so a 600-token budget is spent before the answer starts: measured
 * 2026-09-11, `kimi-k2.7-code` returned zero visible tokens on all three turns
 * and `deepseek-v4.1-flash` on two of three. That reads as "0 tok/s" — a
 * truncation artifact indistinguishable from a dead model. Same trap the
 * bake-off's MAX_TOKENS comment documents for Gemini.
 */
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 120_000;

interface TurnResult {
  ttfbMs: number | null;
  ttftMs: number | null;
  thinkMs: number;
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
  let firstFrameAt: number | null = null;
  let firstTokenAt: number | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let reasoningTokens = 0;
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
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
        // Any parsed data: frame counts toward ttfb (see the usage-shape block
        // comment in benchmark-bakeoff.ts's streamOpenAi() for why reasoning
        // deltas count as a frame but not as visible text).
        firstFrameAt ??= performance.now();
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          text += delta;
        }
        if (parsed.usage) {
          promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
          completionTokens = parsed.usage.completion_tokens ?? completionTokens;
          totalTokens = parsed.usage.total_tokens ?? totalTokens;
          reasoningTokens = parsed.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
        }
      } catch {
        // partial/non-JSON SSE line — skip
      }
    }
  }

  const end = performance.now();
  const ttfbMs = firstFrameAt !== null ? firstFrameAt - start : null;
  const ttftMs = firstTokenAt !== null ? firstTokenAt - start : null;
  const thinkMs =
    firstFrameAt !== null && firstTokenAt !== null ? Math.max(0, firstTokenAt - firstFrameAt) : 0;
  const decodeMs = firstTokenAt !== null ? end - firstTokenAt : end - start;
  const tokensAreEstimated = completionTokens === null;
  // Shape-agnostic billed-output/visible split — see benchmark-bakeoff.ts's
  // streamOpenAi() for the two measured usage shapes this covers.
  const hidden =
    totalTokens !== null && promptTokens !== null && completionTokens !== null
      ? Math.max(0, totalTokens - promptTokens - completionTokens)
      : 0;
  const reasoning = reasoningTokens > 0 ? reasoningTokens : hidden;
  const billedOutput =
    completionTokens !== null ? Math.max(completionTokens, (totalTokens ?? 0) - (promptTokens ?? 0)) : null;
  const tokens =
    billedOutput !== null ? Math.max(0, billedOutput - reasoning) : Math.round(text.length / 4);
  const tokensPerSec = decodeMs > 0 ? tokens / (decodeMs / 1000) : null;

  return { ttfbMs, ttftMs, thinkMs, decodeMs, tokens, tokensPerSec, tokensAreEstimated, text };
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
        `  turn ${i + 1}: ttfb ${result.ttfbMs?.toFixed(0) ?? "—"}ms · think ${result.thinkMs.toFixed(0)}ms · ttft ${result.ttftMs?.toFixed(0) ?? "—"}ms, ` +
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

  // Average over the turns that actually produced an answer, and over those turns
  // only. A turn that spent its whole budget thinking has no ttft and no decode
  // rate to contribute; folding it in as a zero (or dividing a real sum by the
  // full turn count) reports a fast model as a slow one.
  const answered = turnResults.filter((r) => r.ttftMs !== null && (r.tokensPerSec ?? 0) > 0);
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

  const avgTtfb = mean(turnResults.filter((r) => r.ttfbMs !== null).map((r) => r.ttfbMs ?? 0));
  const avgThink = mean(answered.map((r) => r.thinkMs));
  const avgTtft = mean(answered.map((r) => r.ttftMs ?? 0));
  const avgThroughput = mean(answered.map((r) => r.tokensPerSec ?? 0));
  const anyEstimated = turnResults.some((r) => r.tokensAreEstimated);
  const truncated = turnResults.length - answered.length;

  console.log(
    `  avg: ttfb ${avgTtfb.toFixed(0)}ms · think ${avgThink.toFixed(0)}ms · ttft ${avgTtft.toFixed(0)}ms, ${avgThroughput.toFixed(1)} tok/s` +
      (truncated > 0 ? ` (${truncated}/${turnResults.length} turns returned no visible answer)` : "") +
      (anyEstimated ? " (token counts partly estimated)" : ""),
  );

  if (answered.length === 0) {
    console.log(`  every turn ended without visible output — skipping metric_snapshot insert`);
    return;
  }

  await db.insert(metricSnapshot).values([
    {
      model_id: candidate.id,
      source: "live",
      conditions: "default" as const,
      metric: "throughput",
      value: avgThroughput,
      confidence: anyEstimated ? 0.6 : 0.9,
    },
    {
      model_id: candidate.id,
      source: "live",
      conditions: "default" as const,
      metric: "ttft_ms",
      value: avgTtft,
      confidence: 0.9,
    },
    {
      model_id: candidate.id,
      source: "live",
      conditions: "default" as const,
      metric: "ttfb_ms",
      value: avgTtfb,
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
