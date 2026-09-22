// Follow-up to adhoc-cache-probe.ts: that probe's multi-turn shape appended
// only 17-147 tokens per turn — too small to tell real cache advancement from
// chunk-granularity noise (DeepSeek caches in ~64-token chunks; Anthropic-style
// breakpoints need >=1024 tokens per block). This one appends a 2-4k-token
// tool-result-sized blob per turn (varied, so it isn't a byte-identical
// repeat), with cache_control on BOTH the system block and the last user
// block of the *previous* call — the two breakpoints Claude Code actually
// places, the second one sliding forward each turn.
//
//   secrets-run run --env-file=.env.tpl -- bun run scripts/adhoc-cache-probe-realistic.ts <model-id> [...]
import { rawFetch as _unused } from "../src/server/iu/client.js"; // keep tsc happy about the shared client module existing

const ANTHROPIC_VERSION = "2023-06-01";
const SLEEP_MS = 2000;
const RUNS_PER_MODEL = 3;
const TURNS = 6;

function base(): string {
  return (process.env["IU_ANTHROPIC_BASE_URL"] ?? "").replace(/\/+$/, "");
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSystemPrefix(): string {
  const lines: string[] = ["# House rules for this repository (synthetic, for a cache probe)", ""];
  for (let i = 0; i < 900; i++) {
    lines.push(
      `- Rule ${i}: function helper_${i}(x: number, y: string): boolean { ` +
        `return x > ${i} && y.length !== ${i % 7} && Boolean(y.includes("${String(i).padStart(4, "0")}")); }`,
    );
  }
  return lines.join("\n");
}
const SYSTEM_PREFIX = buildSystemPrefix();

/** A varied, tool-result-shaped blob of roughly `approxTokens` tokens — not a
 *  repeat of the same text turn to turn, matching a real grep/file-read result. */
function buildTurnBlob(seed: number, approxTokens: number): string {
  const targetChars = approxTokens * 4;
  const lines: string[] = [`// synthetic tool result, seed ${seed}`];
  let n = seed * 7919;
  while (lines.join("\n").length < targetChars) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    lines.push(
      `  file_${n % 500}.ts:${n % 3000}: const value_${n} = compute(${n % 97}, "${n.toString(36)}"); // ${seed}`,
    );
  }
  return lines.join("\n");
}

interface SseUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}
interface CallResult {
  status: number | "timeout";
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
  outputTokens: number | null;
  text: string;
  error: string | null;
}

type Block = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

async function streamCall(model: string, system: Block[], messages: Msg[]): Promise<CallResult> {
  const key = process.env["IU_API_KEY"] ?? "";
  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetch(`${base()}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION, "x-api-key": key },
      body: JSON.stringify({ model, max_tokens: 150, system, messages, stream: true }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return {
      status: "timeout", ttftMs: null, totalMs: Date.now() - started, inputTokens: null,
      cacheCreation: null, cacheRead: null, outputTokens: null, text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => "");
    return {
      status: resp.status, ttftMs: null, totalMs: Date.now() - started, inputTokens: null,
      cacheCreation: null, cacheRead: null, outputTokens: null, text: "", error: t.slice(0, 300),
    };
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let ttftMs: number | null = null;
  let usage: SseUsage = {};
  let buf = "";
  let text = "";
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
          delta?: { text?: string };
          error?: { message?: string };
        };
        if (evt.type === "message_start" && evt.message?.usage) usage = { ...usage, ...evt.message.usage };
        if (evt.type === "message_delta" && evt.usage) usage = { ...usage, ...evt.usage };
        if (evt.type === "content_block_delta" && evt.delta?.text) text += evt.delta.text;
        if (evt.type === "error" && evt.error?.message) errText = evt.error.message;
      } catch {
        // partial line, next chunk completes it
      }
    }
  }
  return {
    status: resp.status, ttftMs, totalMs: Date.now() - started,
    inputTokens: usage.input_tokens ?? null, cacheCreation: usage.cache_creation_input_tokens ?? null,
    cacheRead: usage.cache_read_input_tokens ?? null, outputTokens: usage.output_tokens ?? null,
    text, error: errText,
  };
}

async function runOnce(model: string, runIdx: number): Promise<void> {
  const system: Block[] = [{ type: "text", text: SYSTEM_PREFIX, cache_control: { type: "ephemeral" } }];
  const messages: Msg[] = [];
  console.log(`\n  -- run ${runIdx} --`);
  console.log("  turn | input | cache_read | cache_creation | output | ratio(read/(read+input))");
  for (let turn = 1; turn <= TURNS; turn++) {
    const blob = buildTurnBlob(runIdx * 100 + turn, 2000 + turn * 350); // ~2k-4k tokens, grows per turn
    const userBlock: Block = {
      type: "text",
      text: `Turn ${turn} tool result (run ${runIdx}):\n${blob}\n\nName one rule number above 500 and one file above from the blob.`,
      cache_control: { type: "ephemeral" }, // the sliding breakpoint, as Claude Code places on the latest turn
    };
    messages.push({ role: "user", content: [userBlock] });
    const r = await streamCall(model, system, messages);
    const total = (r.cacheRead ?? 0) + (r.inputTokens ?? 0);
    const ratio = total > 0 ? (r.cacheRead ?? 0) / total : 0;
    console.log(
      `  ${turn}    | ${r.inputTokens ?? "—"} | ${r.cacheRead ?? "—"} | ${r.cacheCreation ?? "—"} | ${r.outputTokens ?? "—"} | ${ratio.toFixed(2)}` +
        (r.error ? ` ERROR=${r.error}` : r.status !== 200 ? ` status=${r.status}` : ""),
    );
    // Strip this turn's cache_control before it goes into history — only the
    // LATEST user block should ever carry the breakpoint, exactly as Claude
    // Code slides it forward one turn at a time.
    (messages.at(-1) as Msg & { content: Block[] }).content[0]!.cache_control = undefined;
    messages.push({ role: "assistant", content: r.text || "(no text)" });
    if (turn < TURNS) await sleep(SLEEP_MS);
  }
}

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error("usage: bun run scripts/adhoc-cache-probe-realistic.ts <model-id> [...]");
    process.exit(1);
  }
  for (const model of models) {
    console.log(`\n=== ${model}: ${RUNS_PER_MODEL} runs x ${TURNS} turns, 2-4k-token tails, cache_control sliding on last user block ===`);
    for (let run = 1; run <= RUNS_PER_MODEL; run++) await runOnce(model, run);
  }
}

await main();
