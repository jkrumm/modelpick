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

const results = await Promise.all(collectors.map(([, run]) => run(resolve)));

const allMetrics = results.flatMap((r) => r.metrics);
const allUnmatched = results.flatMap((r) => r.unmatched);

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
  `[collect] ${collectors
    .map(([name], i) => `${name}: ${results[i]?.metrics.length} metrics, ${results[i]?.unmatched.length} unmatched`)
    .join(" | ")}`,
);

await client.end();
