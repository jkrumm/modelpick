import { collectOpenRouter } from "../src/server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../src/server/collectors/artificialanalysis.js";
import { collectArtificialAnalysisSpeech } from "../src/server/collectors/artificialanalysis-speech.js";
import { collectModelsDev } from "../src/server/collectors/modelsdev.js";
import { collectEpoch } from "../src/server/collectors/epoch.js";
import { collectLmarena } from "../src/server/collectors/lmarena.js";
import { createIdResolver } from "../src/server/collectors/normalize.js";
import { db, client } from "../src/db/index.js";
import { metricSnapshot, models } from "../src/db/schema.js";

const catalog = await db.select({ id: models.id }).from(models);
const resolve = createIdResolver(catalog.map((m) => m.id));

const collectors = [
  ["openrouter", collectOpenRouter],
  ["artificialanalysis", collectArtificialAnalysis],
  ["aa-speech", collectArtificialAnalysisSpeech],
  ["modelsdev", collectModelsDev],
  ["epoch", collectEpoch],
  ["lmarena", collectLmarena],
] as const;

const settled = await Promise.allSettled(collectors.map(([, run]) => run(resolve)));

// Pair each outcome with its collector name; a failed one is logged by name and the
// successful ones are still persisted, mirroring the daily refresh.
const failed: string[] = [];
const results = settled.flatMap((outcome, i) => {
  const name = collectors[i]![0];
  if (outcome.status === "fulfilled") return [{ name, result: outcome.value }];
  console.error(`[collect] ${name} FAILED: ${String(outcome.reason)}`);
  failed.push(name);
  return [];
});

const allMetrics = results.flatMap((r) => r.result.metrics);
const allUnmatched = results.flatMap((r) => r.result.unmatched);

if (allMetrics.length > 0) {
  await db.insert(metricSnapshot).values(
    allMetrics.map((m) => ({
      model_id: m.model_id,
      source: m.source,
      metric: m.metric,
      value: m.value,
      confidence: m.confidence,
    })),
  );
}

console.log(`[collect] inserted ${allMetrics.length} metric snapshots`);

if (allUnmatched.length > 0) {
  console.log(`[collect] ${allUnmatched.length} unmatched external models (new discovery candidates):`);
  for (const u of allUnmatched) {
    console.log(`  ${u.externalId} — ${u.name}`);
  }
}

console.log(
  `[collect] ${results
    .map(({ name, result }) => `${name}: ${result.metrics.length} metrics, ${result.unmatched.length} unmatched`)
    .join(" | ")}`,
);

await client.end();

if (failed.length > 0) {
  console.error(`[collect] failed collectors: ${failed.join(", ")}`);
  process.exit(1);
}
