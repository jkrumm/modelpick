// One-off: does `thinking: {budget_tokens: N}` (== Claude Code's
// MAX_THINKING_TOKENS on the Anthropic leg) change latency/output for a given
// non-Claude model, the way it does for glm-5.3-flash (docs/decisions/model-configs.md)?
// Fixed moderately-hard prompt, three budgets: none, low, high.
//
//   secrets-run run --env-file=.env.tpl -- bun run scripts/adhoc-thinking-effect.ts <model-id> [...]
import { rawFetch } from "../src/server/iu/client.js";

const ANTHROPIC_VERSION = "2023-06-01";
const PROMPT =
  "A train leaves city A at 60 km/h. Two hours later a car leaves city A on the same " +
  "route at 90 km/h. City A and city B are 540 km apart. Assuming both keep constant " +
  "speed and neither stops, does the car catch the train before either reaches city B? " +
  "Show the key numbers, then answer YES or NO on the final line.";

interface ContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}
interface AnthropicResp {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: Record<string, unknown>;
  error?: { message?: string };
}

function base(): string {
  return (process.env["IU_ANTHROPIC_BASE_URL"] ?? "").replace(/\/+$/, "");
}

async function callOnce(
  model: string,
  budgetTokens: number | null,
): Promise<{ ms: number; status: number | "timeout"; body: AnthropicResp | null; raw: string }> {
  const payload: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: PROMPT }],
  };
  if (budgetTokens !== null) {
    payload["thinking"] = { type: "enabled", budget_tokens: budgetTokens };
  }
  const start = Date.now();
  const r = await rawFetch(`${base()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  const ms = Date.now() - start;
  if (r.status === "timeout") return { ms, status: "timeout", body: null, raw: r.body };
  try {
    return { ms, status: r.status, body: JSON.parse(r.body) as AnthropicResp, raw: r.body };
  } catch {
    return { ms, status: r.status, body: null, raw: r.body };
  }
}

async function runModel(model: string): Promise<void> {
  console.log(`\n=== ${model} ===`);
  const budgets: Array<[string, number | null]> = [
    ["none", null],
    ["low(512)", 512],
    ["high(8192)", 8192],
  ];
  for (const [label, budget] of budgets) {
    const { ms, status, body, raw } = await callOnce(model, budget);
    if (status !== 200 || !body) {
      console.log(`  ${label}: HTTP ${status} — ${raw.slice(0, 300)}`);
      continue;
    }
    if (body.error) {
      console.log(`  ${label}: API error — ${JSON.stringify(body.error).slice(0, 300)}`);
      continue;
    }
    const content = body.content ?? [];
    const thinking = content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
    const thinkingChars = thinking.reduce(
      (n, b) => n + (typeof b["thinking"] === "string" ? (b["thinking"] as string).length : 0),
      0,
    );
    console.log(
      `  ${label}: ${ms}ms, stop=${body.stop_reason}, thinking_chars=${thinkingChars}, ` +
        `usage=${JSON.stringify(body.usage)}, answer_tail="${text.trim().slice(-80)}"`,
    );
  }
}

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error("usage: bun run scripts/adhoc-thinking-effect.ts <model-id> [...]");
    process.exit(1);
  }
  for (const model of models) await runModel(model);
}

await main();
