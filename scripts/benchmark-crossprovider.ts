/**
 * Cross-provider latency/throughput/cost bake-off.
 *
 *   bun run scripts/benchmark-crossprovider.ts [passes] [filter]
 *
 * Answers two questions the single-vendor benchmarks can't:
 *
 *  1. How do the current Google tiers (Pro / Flash / Flash-Lite), the OpenAI line
 *     and the open-weight models actually compare on MEASURED TTFT, decode rate
 *     and billed tokens — as opposed to a leaderboard's throughput column, which
 *     has been wrong by 3.8x here before (see docs/decisions/fast-model.md).
 *  2. What IU's gateway costs us versus talking to Google directly. The same
 *     Gemini id is reachable through IU's `/gemini` passthrough and through
 *     AI Studio on a personal key; only a side-by-side shows the gateway's
 *     overhead and whether IU is routing somewhere slower.
 *
 * Prices come from metric_snapshot (openrouter/artificialanalysis), never from
 * the provider response — IU returns no `cost` field on any route. A model with
 * no stored rate prints `unpriced` rather than a fabricated zero.
 *
 * Results are printed and written to metric_snapshot (source: "live").
 */
import { db, client } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";
import { sql } from "drizzle-orm";

type MetricRow = typeof metricSnapshot.$inferInsert;

type Provider = "iu-openai" | "iu-gemini" | "aistudio";

interface Target {
  /** Model id as the provider expects it. */
  id: string;
  label: string;
  family: "google" | "openai" | "open-weight";
  /** Google tier, or the rough role for the others. Purely for grouping output. */
  tier: string;
  provider: Provider;
  /** Merged into the request body; the reasoning/thinking controls live here. */
  extra?: Record<string, unknown>;
  /** Id to look up in metric_snapshot when it differs from the request id. */
  priceId?: string;
}

const AISTUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

// A prompt long enough to measure a real decode rate rather than a single burst,
// and deterministic enough that output length doesn't swing wildly between models.
const PROMPT =
  "Write a technical explanation of how TCP congestion control works — slow start, " +
  "congestion avoidance, fast retransmit, and how BBR differs from loss-based schemes. " +
  "Aim for about 350 words. Plain prose, no headings, no bullet points.";

// Gemini 3 and the reasoning-tier GPTs bill thinking against the output cap, so a
// tight budget gets spent on thoughts and truncates the visible answer to a stub —
// which then reports a fast decode rate over 40 tokens nobody asked for. Give every
// model enough headroom to actually finish the ~350-word answer.
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 180_000;

const GOOGLE_TIERS: Array<{ id: string; tier: string; label: string }> = [
  { id: "gemini-3.1-pro-preview", tier: "Pro", label: "Gemini 3.1 Pro" },
  { id: "gemini-3.8-flash", tier: "Flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", tier: "Flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", tier: "Flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", tier: "Flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.5-flash-lite", tier: "Flash-Lite", label: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.1-flash-lite", tier: "Flash-Lite", label: "Gemini 3.1 Flash-Lite" },
];

const TARGETS: Target[] = [
  // Google, both doors. Same id, same request shape — the only variable is who
  // terminates the call, which is the entire point of the comparison.
  ...GOOGLE_TIERS.map(
    (m): Target => ({
      id: m.id,
      label: `${m.label} @IU`,
      family: "google",
      tier: m.tier,
      provider: "iu-gemini",
    }),
  ),
  ...GOOGLE_TIERS.map(
    (m): Target => ({
      id: m.id,
      label: `${m.label} @AIStudio`,
      family: "google",
      tier: m.tier,
      provider: "aistudio",
    }),
  ),
  // The one Gemini with an EU deployment — IU-only by definition.
  {
    id: "gemini-3.5-flash-eu",
    label: "Gemini 3.5 Flash EU @IU",
    family: "google",
    tier: "Flash (EU)",
    provider: "iu-openai",
  },

  // OpenAI. The 5.6 siblings are included deliberately: sol/terra are unmeasured
  // here and an ambiguous exclusion has cost this repo the winning model before.
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", family: "openai", tier: "fast", provider: "iu-openai", extra: { reasoning_effort: "none" } },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", family: "openai", tier: "fast", provider: "iu-openai" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", family: "openai", tier: "fast", provider: "iu-openai" },
  { id: "gpt-5.5", label: "GPT-5.5", family: "openai", tier: "frontier", provider: "iu-openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", family: "openai", tier: "cheap", provider: "iu-openai" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", family: "openai", tier: "cheap", provider: "iu-openai" },

  // Open-weight.
  { id: "DeepSeek-V4-Flash", label: "DeepSeek V4 Flash", family: "open-weight", tier: "fast", provider: "iu-openai" },
  { id: "DeepSeek-V4-Pro", label: "DeepSeek V4 Pro", family: "open-weight", tier: "frontier", provider: "iu-openai" },
  { id: "Qwen3.5-397B-A17B", label: "Qwen 3.5 397B", family: "open-weight", tier: "frontier", provider: "iu-openai" },
  { id: "qwen3.8-max", label: "Qwen 3.8 Max", family: "open-weight", tier: "frontier", provider: "iu-openai" },
  { id: "glm-5.3", label: "GLM 5.3", family: "open-weight", tier: "frontier", provider: "iu-openai" },
  { id: "glm-5.3-flash", label: "GLM 5.3 Flash", family: "open-weight", tier: "fast", provider: "iu-openai" },
  { id: "kimi-k3", label: "Kimi K3", family: "open-weight", tier: "frontier", provider: "iu-openai" },
  { id: "gpt-oss-120b", label: "GPT-OSS 120B", family: "open-weight", tier: "fast", provider: "iu-openai" },
];

interface Sample {
  ttftMs: number | null;
  wallMs: number;
  promptTokens: number;
  visibleTokens: number;
  reasoningTokens: number;
  tokensPerSec: number | null;
  region: string;
  backend: string;
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (json: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      onEvent(payload);
    }
  }
}

async function runOpenAi(t: Target): Promise<Sample> {
  const start = performance.now();
  let ttft: number | null = null;
  let usage: Record<string, number> = {};
  const resp = await fetch(`${env("IU_OPENAI_BASE_URL")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("IU_API_KEY")}`,
    },
    body: JSON.stringify({
      model: t.id,
      messages: [{ role: "user", content: PROMPT }],
      max_completion_tokens: MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      ...t.extra,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 180)}`);
  }
  await readSse(resp.body, (payload) => {
    const ev = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    if (ttft === null && (ev.choices?.[0]?.delta?.content ?? "").length > 0) {
      ttft = performance.now() - start;
    }
    if (ev.usage) {
      const reported = ev.usage.completion_tokens_details?.reasoning_tokens ?? 0;
      // Some IU-fronted vendors omit reasoning_tokens but still bill them; the
      // total/prompt/completion residual is the only way to see them.
      const residual = Math.max(
        0,
        (ev.usage.total_tokens ?? 0) - (ev.usage.prompt_tokens ?? 0) - (ev.usage.completion_tokens ?? 0),
      );
      usage = {
        prompt: ev.usage.prompt_tokens ?? 0,
        visible: ev.usage.completion_tokens ?? 0,
        reasoning: reported > 0 ? reported : residual,
      };
    }
  });
  const wall = performance.now() - start;
  const visible = usage["visible"] ?? 0;
  return {
    ttftMs: ttft,
    wallMs: wall,
    promptTokens: usage["prompt"] ?? 0,
    visibleTokens: visible,
    reasoningTokens: usage["reasoning"] ?? 0,
    tokensPerSec: ttft !== null && wall > ttft ? (visible / (wall - ttft)) * 1000 : null,
    region: resp.headers.get("x-ms-region") ?? "-",
    backend: resp.headers.get("x-middleware-forwarded-backend") ?? "-",
  };
}

async function runGemini(t: Target): Promise<Sample> {
  const base = t.provider === "aistudio" ? AISTUDIO_BASE : env("IU_GEMINI_BASE_URL");
  const key = t.provider === "aistudio" ? env("GOOGLE_AI_STUDIO_KEY") : env("IU_API_KEY");
  const start = performance.now();
  let ttft: number | null = null;
  let prompt = 0;
  let visible = 0;
  let thoughts = 0;
  const resp = await fetch(`${base}/models/${t.id}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS, ...t.extra },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 180)}`);
  }
  await readSse(resp.body, (payload) => {
    const ev = JSON.parse(payload) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    const parts = ev.candidates?.[0]?.content?.parts ?? [];
    // A thought part is not a visible token; counting it as TTFT would make a
    // thinking model look faster than it is to a reader.
    const visibleText = parts.some((p) => p.thought !== true && (p.text ?? "").length > 0);
    if (ttft === null && visibleText) ttft = performance.now() - start;
    if (ev.usageMetadata) {
      prompt = ev.usageMetadata.promptTokenCount ?? prompt;
      visible = ev.usageMetadata.candidatesTokenCount ?? visible;
      thoughts = ev.usageMetadata.thoughtsTokenCount ?? thoughts;
    }
  });
  const wall = performance.now() - start;
  return {
    ttftMs: ttft,
    wallMs: wall,
    promptTokens: prompt,
    visibleTokens: visible,
    reasoningTokens: thoughts,
    tokensPerSec: ttft !== null && wall > ttft ? (visible / (wall - ttft)) * 1000 : null,
    region: resp.headers.get("x-ms-region") ?? "-",
    backend: resp.headers.get("x-middleware-forwarded-backend") ?? "-",
  };
}

function median(xs: number[]): number | null {
  const ys = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (ys.length === 0) return null;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[mid]! : (ys[mid - 1]! + ys[mid]!) / 2;
}

interface Rate {
  input: number;
  output: number;
}

/** Latest stored vendor list price per 1M tokens, or null when we have none. */
async function loadRates(): Promise<Map<string, Rate>> {
  const rows = await db.all<{ model_id: string; metric: string; value: number }>(sql`
    select model_id, metric, value from metric_snapshot m
    where metric in ('price_in', 'price_out')
      and captured_at = (
        select max(captured_at) from metric_snapshot
        where model_id = m.model_id and metric = m.metric
      )
  `);
  const out = new Map<string, Rate>();
  for (const r of rows) {
    const cur = out.get(r.model_id) ?? { input: NaN, output: NaN };
    if (r.metric === "price_in") cur.input = r.value;
    else cur.output = r.value;
    out.set(r.model_id, cur);
  }
  return out;
}

async function recordMetrics(rows: MetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(metricSnapshot).values(rows);
  } catch (err) {
    console.log(`  (metric_snapshot skipped: ${err instanceof Error ? err.message : String(err)})`);
  }
}

interface Aggregate {
  target: Target;
  ttft: number | null;
  wall: number | null;
  tps: number | null;
  promptTokens: number;
  visibleTokens: number;
  reasoningTokens: number;
  region: string;
  backend: string;
  error: string | null;
}

async function main(): Promise<void> {
  const passes = Number(process.argv[2] ?? 3);
  const filter = process.argv[3];
  // `family:open-weight` narrows to a whole group; anything else is a substring
  // match on id or label, which is what you want when chasing one model.
  const targets = !filter
    ? TARGETS
    : filter.startsWith("family:")
      ? TARGETS.filter((t) => t.family === filter.slice("family:".length))
      : TARGETS.filter(
          (t) => t.id.includes(filter) || t.label.toLowerCase().includes(filter.toLowerCase()),
        );
  const rates = await loadRates();
  const results: Aggregate[] = [];

  for (const t of targets) {
    const samples: Sample[] = [];
    let error: string | null = null;
    for (let p = 0; p < passes; p++) {
      try {
        samples.push(t.provider === "iu-openai" ? await runOpenAi(t) : await runGemini(t));
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (samples.length === 0) {
      results.push({
        target: t, ttft: null, wall: null, tps: null,
        promptTokens: 0, visibleTokens: 0, reasoningTokens: 0,
        region: "-", backend: "-", error,
      });
      console.log(`${t.label.padEnd(32)} ERROR ${error}`);
      continue;
    }
    const agg: Aggregate = {
      target: t,
      ttft: median(samples.map((s) => s.ttftMs ?? NaN)),
      wall: median(samples.map((s) => s.wallMs)),
      // Derived from the aggregated numbers, not a median of per-pass ratios: one
      // pass whose first visible token lands near the end produces a near-zero
      // decode window and a nonsense rate that a median over ratios can promote.
      tps: null,
      promptTokens: Math.round(median(samples.map((s) => s.promptTokens)) ?? 0),
      visibleTokens: Math.round(median(samples.map((s) => s.visibleTokens)) ?? 0),
      reasoningTokens: Math.round(median(samples.map((s) => s.reasoningTokens)) ?? 0),
      region: samples[0]!.region,
      backend: samples[0]!.backend,
      error,
    };
    if (agg.wall !== null && agg.ttft !== null && agg.wall > agg.ttft) {
      agg.tps = (agg.visibleTokens / (agg.wall - agg.ttft)) * 1000;
    }
    results.push(agg);
    console.log(
      `${t.label.padEnd(32)} ttft ${agg.ttft === null ? "  n/a" : `${Math.round(agg.ttft)}ms`.padStart(7)}` +
        ` · ${agg.tps === null ? "n/a" : agg.tps.toFixed(0).padStart(4)} tok/s` +
        ` · wall ${(agg.wall! / 1000).toFixed(1)}s` +
        ` · out ${agg.visibleTokens}+${agg.reasoningTokens} think` +
        ` · region ${agg.region}` +
        (error ? ` · partial: ${error}` : ""),
    );
  }

  console.log("\n\n########## SUMMARY ##########\n");
  for (const family of ["google", "openai", "open-weight"] as const) {
    const rows = results.filter((r) => r.target.family === family && r.wall !== null);
    if (rows.length === 0) continue;
    console.log(`\n### ${family}\n`);
    console.log("| Model | Tier | Door | TTFT | tok/s | Wall | Out (vis+think) | $/1M in→out | Cost this run | Region |");
    console.log("|-|-|-|-|-|-|-|-|-|-|");
    for (const r of rows.sort((a, b) => (a.ttft ?? 1e9) - (b.ttft ?? 1e9))) {
      const rate = rates.get(r.target.priceId ?? r.target.id);
      const priced = rate && Number.isFinite(rate.input) && Number.isFinite(rate.output);
      const cost = priced
        ? (r.promptTokens * rate.input + (r.visibleTokens + r.reasoningTokens) * rate.output) / 1_000_000
        : null;
      const door =
        r.target.provider === "aistudio" ? "AI Studio" : r.target.provider === "iu-gemini" ? "IU /gemini" : "IU /openai";
      console.log(
        `| ${r.target.label.replace(/ @.*$/, "")} | ${r.target.tier} | ${door} ` +
          `| ${r.ttft === null ? "n/a" : `${Math.round(r.ttft)}ms`} ` +
          `| ${r.tps === null ? "n/a" : r.tps.toFixed(0)} ` +
          `| ${(r.wall! / 1000).toFixed(1)}s ` +
          `| ${r.visibleTokens}+${r.reasoningTokens} ` +
          `| ${priced ? `$${rate.input} → $${rate.output}` : "unpriced"} ` +
          `| ${cost === null ? "unpriced" : `$${cost.toFixed(6)}`} ` +
          `| ${r.region} |`,
      );
    }
  }

  // IU vs AI Studio, same id both sides — the gateway-overhead question.
  const gatewayRows = results.filter((r) => r.target.family === "google" && r.wall !== null);
  const byId = new Map<string, { iu?: Aggregate; studio?: Aggregate }>();
  for (const r of gatewayRows) {
    const slot = byId.get(r.target.id) ?? {};
    if (r.target.provider === "aistudio") slot.studio = r;
    else if (r.target.provider === "iu-gemini") slot.iu = r;
    byId.set(r.target.id, slot);
  }
  const pairs = [...byId.entries()].filter(([, v]) => v.iu && v.studio);
  if (pairs.length > 0) {
    console.log("\n### IU /gemini passthrough vs Google AI Studio direct (same model id)\n");
    console.log("| Model | TTFT IU | TTFT AI Studio | Δ | tok/s IU | tok/s AI Studio | Wall IU | Wall AI Studio |");
    console.log("|-|-|-|-|-|-|-|-|");
    for (const [id, v] of pairs) {
      const a = v.iu!;
      const b = v.studio!;
      const delta =
        a.ttft !== null && b.ttft !== null ? `${a.ttft > b.ttft ? "+" : ""}${Math.round(a.ttft - b.ttft)}ms` : "n/a";
      console.log(
        `| ${id} | ${a.ttft === null ? "n/a" : `${Math.round(a.ttft)}ms`} | ${b.ttft === null ? "n/a" : `${Math.round(b.ttft)}ms`} | ${delta} ` +
          `| ${a.tps?.toFixed(0) ?? "n/a"} | ${b.tps?.toFixed(0) ?? "n/a"} ` +
          `| ${(a.wall! / 1000).toFixed(1)}s | ${(b.wall! / 1000).toFixed(1)}s |`,
      );
    }
  }

  const rows: MetricRow[] = [];
  for (const r of results) {
    if (r.wall === null || r.target.provider === "aistudio") continue;
    if (r.ttft !== null) {
      rows.push({ model_id: r.target.id, source: "live", metric: "ttft_ms", value: r.ttft, confidence: 0.7 });
    }
    if (r.tps !== null) {
      rows.push({ model_id: r.target.id, source: "live", metric: "throughput", value: r.tps, confidence: 0.7 });
    }
  }
  await recordMetrics(rows);
  await client.end();
}

await main();
