// One-off: Anthropic-leg tool-use conformance for a handful of non-Claude
// gateway ids. Runs a scripted 3-round tool loop (three sequential lookups,
// then a final answer that must combine all three results) with extended
// thinking enabled, and checks:
//   - turn 1 returns stop_reason "tool_use" with a well-formed tool_use block
//   - the tool_result on the following turn is accepted (no 400)
//   - thinking/redacted_thinking blocks, when present, are round-tripped
//     unmodified (incl. any `signature` field) on every subsequent turn —
//     DeepSeek V4 is documented elsewhere to require this
//   - the loop still produces a correct final answer at turn 3+
//
//   secrets-run run --env-file=.env.tpl -- bun run scripts/adhoc-tool-conformance.ts <model-id> [...]
import { rawFetch } from "../src/server/iu/client.js";

const ANTHROPIC_VERSION = "2023-06-01";
const CODES: Record<string, number> = { alpha: 7, beta: 11, gamma: 5 };

const TOOL = {
  name: "lookup_code",
  description: "Look up the numeric code assigned to a key.",
  input_schema: {
    type: "object",
    properties: { key: { type: "string", enum: Object.keys(CODES) } },
    required: ["key"],
  },
};

const SYSTEM =
  "You have a lookup_code tool. Look up the codes for 'alpha', 'beta' and 'gamma' " +
  "ONE AT A TIME (one tool call per turn), then reply with their sum as a single number.";

interface ContentBlock {
  type: string;
  [k: string]: unknown;
}

interface AnthropicResp {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: Record<string, number>;
  error?: { message?: string; type?: string };
}

function base(): string {
  return (process.env["IU_ANTHROPIC_BASE_URL"] ?? "").replace(/\/+$/, "");
}

async function send(
  model: string,
  messages: Array<{ role: string; content: ContentBlock[] | string }>,
  useThinking: boolean,
): Promise<{ status: number | "timeout"; body: AnthropicResp | null; raw: string }> {
  const payload: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    system: SYSTEM,
    tools: [TOOL],
    messages,
  };
  if (useThinking) {
    payload["thinking"] = { type: "enabled", budget_tokens: 2048 };
  }
  const r = await rawFetch(`${base()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (r.status === "timeout") return { status: "timeout", body: null, raw: r.body };
  try {
    return { status: r.status, body: JSON.parse(r.body) as AnthropicResp, raw: r.body };
  } catch {
    return { status: r.status, body: null, raw: r.body };
  }
}

async function runModel(model: string, useThinking: boolean): Promise<void> {
  console.log(`\n=== ${model} (thinking=${useThinking}) ===`);
  const messages: Array<{ role: string; content: ContentBlock[] | string }> = [
    { role: "user", content: "Use the tool to find alpha, beta and gamma's codes, then sum them." },
  ];

  let round = 0;
  let sawThinkingEver = false;
  let failed = false;

  while (round < 6) {
    round++;
    const { status, body, raw } = await send(model, messages, useThinking);
    if (status !== 200 || !body) {
      console.log(`  round ${round}: HTTP ${status} — ${raw.slice(0, 500)}`);
      failed = true;
      break;
    }
    if (body.error) {
      console.log(`  round ${round}: API error — ${JSON.stringify(body.error).slice(0, 500)}`);
      failed = true;
      break;
    }

    const content = body.content ?? [];
    const thinkingBlocks = content.filter(
      (b) => b.type === "thinking" || b.type === "redacted_thinking",
    );
    const toolUseBlocks = content.filter((b) => b.type === "tool_use");
    const textBlocks = content.filter((b) => b.type === "text");
    if (thinkingBlocks.length > 0) sawThinkingEver = true;

    console.log(
      `  round ${round}: stop_reason=${body.stop_reason} blocks=[${content.map((b) => b.type).join(",")}] usage=${JSON.stringify(body.usage)}`,
    );

    // Echo the assistant turn back verbatim (thinking blocks included,
    // unmodified) — this is the shape a real Claude Code-style tool loop
    // must produce, and the thing DeepSeek V4 is reported to require.
    messages.push({ role: "assistant", content });

    if (body.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      const toolResults: ContentBlock[] = toolUseBlocks.map((tb) => {
        const input = tb["input"] as { key?: string } | undefined;
        const key = input?.key ?? "";
        const code = CODES[key];
        return {
          type: "tool_result",
          tool_use_id: tb["id"],
          content: code !== undefined ? String(code) : `unknown key: ${key}`,
        };
      });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // No more tool calls — this should be the final answer.
    const finalText = textBlocks.map((b) => b["text"]).join(" ");
    const expectedSum = Object.values(CODES).reduce((a, b) => a + b, 0);
    const gotSum = finalText.match(/\b(\d+)\b/)?.[1];
    console.log(
      `  final (round ${round}): "${finalText.slice(0, 200)}" — expected sum ${expectedSum}, ` +
        `found ${gotSum ?? "none"} — ${gotSum === String(expectedSum) ? "CORRECT" : "WRONG/AMBIGUOUS"}`,
    );
    break;
  }

  if (round >= 6 && !failed) {
    console.log("  did not converge within 6 rounds");
  }
  console.log(`  rounds used: ${round}, saw thinking blocks: ${sawThinkingEver}, failed: ${failed}`);
}

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error("usage: bun run scripts/adhoc-tool-conformance.ts <model-id> [...]");
    process.exit(1);
  }
  for (const model of models) {
    await runModel(model, false);
    await runModel(model, true);
  }
}

await main();
