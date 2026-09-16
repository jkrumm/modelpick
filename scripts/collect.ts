import { collectOpenRouter } from "../src/server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../src/server/collectors/artificialanalysis.js";
import { collectEpoch } from "../src/server/collectors/epoch.js";
import { collectEqbench } from "../src/server/collectors/eqbench.js";
import { collectLmarena } from "../src/server/collectors/lmarena.js";
import { createIdResolver } from "../src/server/collectors/normalize.js";
import { db, client } from "../src/db/index.js";
import { metricSnapshot, models } from "../src/db/schema.js";

const catalog = await db.select({ id: models.id }).from(models);
const resolve = createIdResolver(catalog.map((m) => m.id));

const [orResult, aaResult, epochResult, eqbenchResult, lmarenaResult] = await Promise.all([
  collectOpenRouter(resolve),
  collectArtificialAnalysis(resolve),
  collectEpoch(resolve),
  collectEqbench(resolve),
  collectLmarena(resolve),
]);

const allMetrics = [
  ...orResult.metrics,
  ...aaResult.metrics,
  ...epochResult.metrics,
  ...eqbenchResult.metrics,
  ...lmarenaResult.metrics,
];
const allUnmatched = [
  ...orResult.unmatched,
  ...aaResult.unmatched,
  ...epochResult.unmatched,
  ...eqbenchResult.unmatched,
  ...lmarenaResult.unmatched,
];

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

const orStats = `openrouter: ${orResult.metrics.length} metrics, ${orResult.unmatched.length} unmatched`;
const aaStats = `artificialanalysis: ${aaResult.metrics.length} metrics, ${aaResult.unmatched.length} unmatched`;
const epochStats = `epoch: ${epochResult.metrics.length} metrics, ${epochResult.unmatched.length} unmatched`;
const eqbenchStats = `eqbench: ${eqbenchResult.metrics.length} metrics, ${eqbenchResult.unmatched.length} unmatched`;
const lmarenaStats = `lmarena: ${lmarenaResult.metrics.length} metrics, ${lmarenaResult.unmatched.length} unmatched`;
console.log(`[collect] ${orStats} | ${aaStats} | ${epochStats} | ${eqbenchStats} | ${lmarenaStats}`);

await client.end();
