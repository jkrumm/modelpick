/**
 * Surveys the IU unified endpoint's Anthropic-protocol route and helps pick
 * which model to run Claude Code against.
 *
 *   bun run scripts/pick.ts [--json] [--no-probe]
 *
 * Lists what the route currently serves, live-probes every non-Claude id
 * (derived pricing from the gateway's Requesty `usage.cost`, prompt-caching
 * support, whether `max_tokens` is honoured, always-thinking, and a
 * binary-searched context window), prints a comparison table sorted by output
 * price, then offers an interactive picklist and prints the exact `ca
 * <model>` line to launch Claude Code against the chosen one.
 *
 * Results are cached in the `pick_probe` table (src/db/schema.ts) — repeated
 * runs only probe models that have never been probed before. `--no-probe`
 * renders purely from cache + the baked-in seed table, spending nothing.
 */
import { createInterface } from "node:readline/promises";
import { db, client } from "../src/db/index.js";
import { pickProbe } from "../src/db/schema.js";
import { listAnthropicModels, isClaudeModel } from "../src/server/pick/anthropic.js";
import { probePickModel } from "../src/server/pick/probe.js";
import { formatCostEstimateLine } from "../src/server/pick/cost-estimate.js";
import {
  rowFromLiveProbe,
  rowFromCache,
  rowFromSeed,
  renderTable,
  toJson,
  isUsableForAgentLoop,
  sortByOutputPriceAsc,
  launchLine,
  type ComparisonRow,
} from "../src/server/pick/format.js";

const DEFAULT_MODEL = "DeepSeek-V4-Flash";
const PICK_CONCURRENCY = 3;

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const noProbe = args.includes("--no-probe");
/** Skip the spend confirmation. Required in a non-interactive shell. */
const assumeYes = args.includes("--yes") || args.includes("-y");

/**
 * `--model <id>` (repeatable) narrows the probe to specific ids. Probing costs
 * real money and the context-window search dominates that cost, so re-probing
 * one model must not mean re-probing the whole route.
 */
function parseModelFilter(argv: string[]): string[] {
  const ids: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === "--model" && argv[i + 1]) ids.push(argv[i + 1] as string);
    else if (arg.startsWith("--model=")) ids.push(arg.slice("--model=".length));
  });
  return ids;
}
const modelFilter = parseModelFilter(args);

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function persistProbeResult(row: ComparisonRow): Promise<void> {
  await db
    .insert(pickProbe)
    .values({
      model_id: row.modelId,
      price_in_per_m: row.priceInPerM,
      price_out_per_m: row.priceOutPerM,
      price_cache_read_per_m: row.priceCacheReadPerM,
      supports_cache_read: row.supportsCacheRead,
      honors_max_tokens: row.honorsMaxTokens,
      always_thinking: row.alwaysThinking,
      context_window: row.contextWindow,
      context_window_exact: row.contextWindowExact,
      notes: row.notes.length > 0 ? row.notes.join(" | ") : null,
    })
    .onConflictDoUpdate({
      target: pickProbe.model_id,
      set: {
        price_in_per_m: row.priceInPerM,
        price_out_per_m: row.priceOutPerM,
        price_cache_read_per_m: row.priceCacheReadPerM,
        supports_cache_read: row.supportsCacheRead,
        honors_max_tokens: row.honorsMaxTokens,
        always_thinking: row.alwaysThinking,
        context_window: row.contextWindow,
        context_window_exact: row.contextWindowExact,
        notes: row.notes.length > 0 ? row.notes.join(" | ") : null,
        probed_at: new Date().toISOString(),
      },
    });
}

/**
 * Probing spends real money against the gateway, so it never starts implicitly.
 * A non-interactive shell has nobody to answer, so it must pass --yes rather
 * than have the prompt silently auto-accept.
 */
async function confirmSpend(count: number): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.log(`Refusing to probe ${count} model(s) unattended — re-run with --yes.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Spend that to probe? [y/N] ");
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

async function pickAndLaunch(rows: ComparisonRow[]): Promise<void> {
  const usable = sortByOutputPriceAsc(rows.filter(isUsableForAgentLoop));
  if (usable.length === 0) {
    console.log("\nNo model came back usable for an agent loop — nothing to pick from.");
    return;
  }

  const defaultIndex = Math.max(
    0,
    usable.findIndex((r) => r.modelId === DEFAULT_MODEL),
  );

  console.log("\nUsable for an agent loop:");
  usable.forEach((row, i) => {
    const marker = i === defaultIndex ? "*" : " ";
    console.log(`  ${marker} ${i + 1}. ${row.modelId}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question(
      `\nPick a model [${defaultIndex + 1}: ${usable[defaultIndex]?.modelId ?? DEFAULT_MODEL}] (number, Enter for default): `,
    );
  } finally {
    rl.close();
  }

  const trimmed = answer.trim();
  const chosenIndex = trimmed === "" ? defaultIndex : Number(trimmed) - 1;
  const chosen = usable[chosenIndex] ?? usable[defaultIndex];
  if (!chosen) return;

  console.log(`\n${launchLine(chosen.modelId)}`);
}

async function main(): Promise<void> {
  // The route lists at least one id twice (glm-5.2) — dedupe before anything
  // counts, probes, or renders it.
  const liveIds = [...new Set(await listAnthropicModels())];
  const claudeCount = liveIds.filter(isClaudeModel).length;
  const nonClaudeIds = liveIds.filter((id) => !isClaudeModel(id));

  console.log(
    `Anthropic route: ${liveIds.length} models (${claudeCount} Claude, ${nonClaudeIds.length} non-Claude).`,
  );

  const cachedRows = nonClaudeIds.length > 0 ? await db.select().from(pickProbe) : [];
  const cachedById = new Map(cachedRows.map((r) => [r.model_id, r]));

  // An explicit --model re-probes even when cached; otherwise only fill gaps.
  const toProbe = noProbe
    ? []
    : modelFilter.length > 0
      ? nonClaudeIds.filter((id) => modelFilter.includes(id))
      : nonClaudeIds.filter((id) => !cachedById.has(id));

  if (modelFilter.length > 0) {
    const unknown = modelFilter.filter((id) => !nonClaudeIds.includes(id));
    if (unknown.length > 0) {
      throw new Error(
        `--model given ids the Anthropic route does not serve as non-Claude models: ${unknown.join(", ")}`,
      );
    }
  }

  if (toProbe.length > 0) {
    console.log(formatCostEstimateLine(toProbe));
    if (!(await confirmSpend(toProbe.length))) {
      console.log("Aborted — nothing probed, nothing spent.");
      await client.end();
      return;
    }
    const probed = await mapPool(toProbe, PICK_CONCURRENCY, async (modelId) => {
      try {
        return rowFromLiveProbe(await probePickModel(modelId));
      } catch (err) {
        console.warn(`[pick] probe failed for ${modelId}: ${err instanceof Error ? err.message : String(err)}`);
        return rowFromSeed(modelId);
      }
    });
    for (const row of probed) {
      await persistProbeResult(row);
      cachedById.set(row.modelId, {
        id: 0,
        model_id: row.modelId,
        price_in_per_m: row.priceInPerM,
        price_out_per_m: row.priceOutPerM,
        price_cache_read_per_m: row.priceCacheReadPerM,
        supports_cache_read: row.supportsCacheRead,
        honors_max_tokens: row.honorsMaxTokens,
        always_thinking: row.alwaysThinking,
        context_window: row.contextWindow,
        context_window_exact: row.contextWindowExact,
        notes: row.notes.length > 0 ? row.notes.join(" | ") : null,
        probed_at: new Date().toISOString(),
      });
    }
  } else if (!noProbe) {
    console.log("All non-Claude models already cached — nothing new to probe.");
  }

  const rows: ComparisonRow[] = nonClaudeIds.map((id) => {
    const cached = cachedById.get(id);
    return cached ? rowFromCache(cached) : rowFromSeed(id);
  });

  if (jsonMode) {
    console.log(JSON.stringify(toJson(rows), null, 2));
    await client.end();
    return;
  }

  console.log("");
  console.log(renderTable(rows));

  if (!process.stdin.isTTY) {
    console.log("\n(non-interactive shell — skipping the picklist; pass --json for scripted use)");
    await client.end();
    return;
  }

  await pickAndLaunch(rows);
  await client.end();
}

await main();
