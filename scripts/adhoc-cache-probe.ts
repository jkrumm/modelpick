// One-off: why does DeepSeek-V4-Pro barely reuse the prompt cache on the
// Anthropic leg (9% headless / 26% interactive) while DeepSeek-V4-Flash and
// glm-5.3-flash hit 94-97% on the same route? Direct streamed /v1/messages
// calls, not through Claude Code, so every knob is visible: a fixed ~20k-token
// system prefix with cache_control on the last block (as Claude Code sends
// it), 8 calls ~2s apart, per-call usage + TTFT + the gateway's own
// backend-naming headers. Then the same 8 calls with no cache_control at all
// (does the backend cache implicitly?), then a 6-turn growing conversation
// (does cache_read advance past the system block, or stay stuck there?).
//
//   secrets-run run --env-file=.env.tpl -- bun run scripts/adhoc-cache-probe.ts <model-id> [...]
import { rawFetch } from "../src/server/iu/client.js";

const ANTHROPIC_VERSION = "2023-06-01";
const SLEEP_MS = 2000;

function base(): string {
  return (process.env["IU_ANTHROPIC_BASE_URL"] ?? "").replace(/\/+$/, "");
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ~20k tokens of code-shaped filler (not lorem — closer to what a real system
// prompt looks like, though content doesn't affect literal-prefix caching).
function buildSystemPrefix(): string {
  const lines: string[] = [
    "# House rules for this repository (synthetic, for a cache probe)",
    "",
  ];
  for (let i = 0; i < 900; i++) {
    lines.push(
      `- Rule ${i}: function helper_${i}(x: number, y: string): boolean { ` +
        `return x > ${i} && y.length !== ${i % 7} && Boolean(y.includes("${String(i).padStart(4, "0")}")); }`,
    );
  }
  return lines.join("\n");
}
const SYSTEM_PREFIX = buildSystemPrefix();

interface CallResult {
  ok: boolean;
  status: number | "timeout";
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
  outputTokens: number | null;
  server: string | null;
  upstreamModel: string | null;
  allHeaders: Record<string, string>;
  error: string | null;
}

interface SseUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** Streams one /messages call, parsing SSE for TTFT + usage without pulling in
 *  a full Anthropic SDK — this route's shape is simple enough to hand-parse. */
async function streamCall(
  model: string,
  systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<CallResult> {
  const key = process.env["IU_API_KEY"] ?? "";
  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetch(`${base()}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": key,
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: systemBlocks,
        messages,
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: "timeout",
      ttftMs: null,
      totalMs: Date.now() - started,
      inputTokens: null,
      cacheCreation: null,
      cacheRead: null,
      outputTokens: null,
      server: null,
      upstreamModel: null,
      allHeaders: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const allHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    allHeaders[k] = v;
  });
  const server = resp.headers.get("x-middleware-forwarded-server");
  const upstreamModel = resp.headers.get("x-middleware-forwarded-model");

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    return {
      ok: false,
      status: resp.status,
      ttftMs: null,
      totalMs: Date.now() - started,
      inputTokens: null,
      cacheCreation: null,
      cacheRead: null,
      outputTokens: null,
      server,
      upstreamModel,
      allHeaders,
      error: text.slice(0, 400),
    };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let ttftMs: number | null = null;
  let usage: SseUsage = {};
  let buf = "";
  let errText: string | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttftMs === null) ttftMs = Date.now() - started;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "" || raw === "[DONE]") continue;
      try {
        const evt = JSON.parse(raw) as {
          type?: string;
          message?: { usage?: SseUsage };
          usage?: SseUsage;
          error?: { message?: string };
        };
        if (evt.type === "message_start" && evt.message?.usage) {
          usage = { ...usage, ...evt.message.usage };
        }
        if (evt.type === "message_delta" && evt.usage) {
          usage = { ...usage, ...evt.usage };
        }
        if (evt.type === "error" && evt.error?.message) {
          errText = evt.error.message;
        }
      } catch {
        // partial/non-JSON line — ignore, next chunk completes it
      }
    }
  }

  return {
    ok: errText === null,
    status: resp.status,
    ttftMs,
    totalMs: Date.now() - started,
    inputTokens: usage.input_tokens ?? null,
    cacheCreation: usage.cache_creation_input_tokens ?? null,
    cacheRead: usage.cache_read_input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    server,
    upstreamModel,
    allHeaders,
    error: errText,
  };
}

function row(i: number, r: CallResult): string {
  return (
    `  #${i} status=${r.status} server=${r.server ?? "—"} upstream=${r.upstreamModel ?? "—"} ` +
    `ttft=${r.ttftMs ?? "—"}ms total=${r.totalMs}ms in=${r.inputTokens ?? "—"} ` +
    `cache_read=${r.cacheRead ?? "—"} cache_creation=${r.cacheCreation ?? "—"} out=${r.outputTokens ?? "—"}` +
    (r.error ? ` ERROR=${r.error}` : "")
  );
}

async function withCacheControl(model: string): Promise<void> {
  console.log(`\n--- ${model}: 8 calls, cache_control on last system block ---`);
  for (let i = 1; i <= 8; i++) {
    const systemBlocks = [
      { type: "text" as const, text: SYSTEM_PREFIX, cache_control: { type: "ephemeral" as const } },
    ];
    const messages = [{ role: "user" as const, content: `Call ${i}: name one rule number above 500, briefly.` }];
    const r = await streamCall(model, systemBlocks, messages);
    console.log(row(i, r));
    if (i === 1) console.log(`  [headers on call 1] ${JSON.stringify(r.allHeaders)}`);
    if (i < 8) await sleep(SLEEP_MS);
  }
}

async function withoutCacheControl(model: string): Promise<void> {
  console.log(`\n--- ${model}: 8 calls, NO cache_control (implicit caching?) ---`);
  for (let i = 1; i <= 8; i++) {
    const systemBlocks = [{ type: "text" as const, text: SYSTEM_PREFIX }];
    const messages = [{ role: "user" as const, content: `Call ${i}: name one rule number above 500, briefly.` }];
    const r = await streamCall(model, systemBlocks, messages);
    console.log(row(i, r));
    if (i < 8) await sleep(SLEEP_MS);
  }
}

async function multiTurn(model: string): Promise<void> {
  console.log(`\n--- ${model}: 6-turn growing conversation, cache_control on system ---`);
  const systemBlocks = [
    { type: "text" as const, text: SYSTEM_PREFIX, cache_control: { type: "ephemeral" as const } },
  ];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let turn = 1; turn <= 6; turn++) {
    messages.push({ role: "user", content: `Turn ${turn}: name one different rule number above 500, briefly.` });
    const r = await streamCall(model, systemBlocks, messages);
    console.log(row(turn, r));
    // Extend the conversation the way an agent loop does — the model's own
    // reply becomes prior context for the next turn.
    messages.push({ role: "assistant", content: `(synthetic ack ${turn})` });
    if (turn < 6) await sleep(SLEEP_MS);
  }
}

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error("usage: bun run scripts/adhoc-cache-probe.ts <model-id> [...]");
    process.exit(1);
  }
  for (const model of models) {
    await withCacheControl(model);
    await withoutCacheControl(model);
    await multiTurn(model);
  }
}

await main();
