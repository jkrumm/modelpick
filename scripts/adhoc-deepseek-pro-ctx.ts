// One-off: DeepSeek-V4-Pro's context probe times out at the harness's default
// 60s. Retry the same probe shape with a much longer timeout to tell apart
// "genuinely unresponsive" from "just slow to chew a 1.1M-token prompt".
import { anthropicMessage } from "../src/server/pick/anthropic.js";

const FILLER_WORDS =
  "the quick brown fox jumps over the lazy dog while probing context window limits on the gateway ";
function buildFiller(approxTokens: number): string {
  const targetChars = approxTokens * 4;
  let out = "";
  while (out.length < targetChars) out += FILLER_WORDS;
  return out.slice(0, targetChars);
}

const sizes = [1_100_000, 600_000, 300_000, 150_000];

for (const size of sizes) {
  const start = Date.now();
  console.log(`probing ${size} tokens...`);
  const res = await anthropicMessage(
    {
      model: "DeepSeek-V4-Pro",
      max_tokens: 1,
      messages: [{ role: "user", content: buildFiller(size) }],
    },
    { timeoutMs: 300_000 },
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `  size=${size} ok=${res.ok} status=${res.status} elapsed=${elapsed}s error=${res.errorText?.slice(0, 300) ?? "none"}`,
  );
  if (res.ok) break;
}
