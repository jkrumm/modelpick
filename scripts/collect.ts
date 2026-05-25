import { collectOpenRouter } from "../src/server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../src/server/collectors/artificialanalysis.js";
import { createIdResolver } from "../src/server/collectors/normalize.js";
import { db, client } from "../src/db/index.js";
import { metricSnapshot, models } from "../src/db/schema.js";

const catalog = await db.select({ id: models.id }).from(models);
const resolve = createIdResolver(catalog.map((m) => m.id));

const [orResult, aaResult] = await Promise.all([
  collectOpenRouter(resolve),
  collectArtificialAnalysis(resolve),
]);

const allMetrics = [...orResult.metrics, ...aaResult.metrics];
const allUnmatched = [...orResult.unmatched, ...aaResult.unmatched];

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
console.log(`[collect] ${orStats} | ${aaStats}`);

await client.end();
