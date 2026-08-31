/**
 * Surveys where each Claude id on the IU Anthropic route physically lands.
 *
 *   bun run scripts/route-map.ts [--json] [--all]
 *
 * The catalog does not say that `claude-sonnet-4-6` resolves to Vertex us-east
 * while `claude-sonnet-4-6-eu` is Bedrock eu-west-1, nor that `claude-opus-5`
 * is already EU-pinned with no `-eu` twin to reach for. The gateway's own
 * forwarding headers do. By default this surveys the Claude ids only; `--all`
 * includes the Requesty-proxied rest of the route.
 *
 * Costs 8 output tokens per id — cheap enough to re-run whenever the route
 * looks like it has moved.
 */
import { client } from "../src/db/index.js";
import { listAnthropicModels, isClaudeModel } from "../src/server/pick/anthropic.js";
import { probeRoute, renderRouteMap, classifyResidency } from "../src/server/bench/route.js";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const includeAll = args.includes("--all");

const ids = [...new Set(await listAnthropicModels())]
  .filter((id) => includeAll || isClaudeModel(id))
  .toSorted();

// Sequential on purpose: the survey reads latency alongside the headers, and
// concurrent calls would contaminate the only cheap timing signal it has.
const backends = [];
for (const id of ids) backends.push(await probeRoute(id));

if (jsonMode) {
  console.log(
    JSON.stringify(
      backends.map((b) => ({ ...b, residency: b.status === 200 ? classifyResidency(b) : null })),
      null,
      2,
    ),
  );
} else {
  const dead = backends.filter((b) => b.status !== 200);
  console.log(renderRouteMap(backends.filter((b) => b.status === 200)));
  if (dead.length > 0) {
    console.log(
      `\nListed but not callable: ${dead.map((b) => `${b.modelId} (${b.status})`).join(", ")}`,
    );
  }
}

await client.end();
