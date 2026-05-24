import { runRefresh } from "../src/server/refresh.js";
import { runProbe } from "../src/server/iu/probe.js";
import { collectOpenRouter } from "../src/server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../src/server/collectors/artificialanalysis.js";
import { runRecommender } from "../src/server/scoring/recommend.js";
import { collectNews } from "../src/server/collectors/news.js";
import { db, client } from "../src/db/index.js";
import { metricSnapshot } from "../src/db/schema.js";

const result = await runRefresh({
  probe: runProbe,
  collectOpenRouter,
  collectArtificialAnalysis,
  insertMetrics: async (metrics) => {
    if (metrics.length === 0) return;
    await db.insert(metricSnapshot).values(
      metrics.map((m) => ({
        model_id: m.model_id,
        source: m.source,
        metric: m.metric,
        value: m.value,
        confidence: m.confidence,
      })),
    );
  },
  runRecommender,
  collectNews,
});

if (!result.allOk) {
  const failed = (
    Object.entries(result) as Array<[string, { ok: boolean } | boolean]>
  )
    .filter(([k, v]) => k !== "allOk" && typeof v === "object" && !v.ok)
    .map(([k]) => k);
  console.error(`[refresh] failed steps: ${failed.join(", ")}`);
  await client.end();
  process.exit(1);
}

await client.end();
