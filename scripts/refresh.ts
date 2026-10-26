import { join } from "node:path";
import { runRefresh } from "../src/server/refresh.js";
import { runProbe } from "../src/server/iu/probe.js";
import { collectOpenRouter } from "../src/server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../src/server/collectors/artificialanalysis.js";
import { collectEpoch } from "../src/server/collectors/epoch.js";
import { collectEqbench } from "../src/server/collectors/eqbench.js";
import { collectLmarena } from "../src/server/collectors/lmarena.js";
import { syncCatalog } from "../src/server/iu/catalog-sync.js";
import {
  commitSnapshot,
  createSnapshotCommitDeps,
  IU_CATALOG_COMMIT_MESSAGE,
  IU_CATALOG_SNAPSHOT_PATH,
} from "../src/server/snapshot-commit.js";
import { runRecommender } from "../src/server/scoring/recommend.js";
import { createIdResolver } from "../src/server/collectors/normalize.js";
import { db, client } from "../src/db/index.js";
import { metricSnapshot, models } from "../src/db/schema.js";

// Resolver is built at collect time (after the probe step has merged in any new
// IU models) so leaderboard ids reconcile against the full current catalog.
async function buildResolver() {
  const catalog = await db.select({ id: models.id }).from(models);
  return createIdResolver(catalog.map((m) => m.id));
}

const result = await runRefresh({
  syncCatalog,
  probe: runProbe,
  collectOpenRouter: async () => collectOpenRouter(await buildResolver()),
  collectArtificialAnalysis: async () => collectArtificialAnalysis(await buildResolver()),
  collectEpoch: async () => collectEpoch(await buildResolver()),
  collectEqbench: async () => collectEqbench(await buildResolver()),
  collectLmarena: async () => collectLmarena(await buildResolver()),
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
});

// collectEpoch and syncCatalog rewrite tracked files; ship them so the unattended checkout
// stays clean. Never throws — a git problem must not fail the refresh. The catalog snapshot
// is committed only when its step succeeded (syncCatalog writes it last, after the DB).
const gitDeps = createSnapshotCommitDeps(join(import.meta.dirname, ".."));
await commitSnapshot(gitDeps);
if (result.catalog.ok) {
  await commitSnapshot(gitDeps, IU_CATALOG_SNAPSHOT_PATH, IU_CATALOG_COMMIT_MESSAGE);
}

if (!result.allOk) {
  const failed = (["catalog", "probe", "collect", "recommend"] as const).filter((k) => !result[k].ok);
  console.error(
    `[refresh] not ok — failed steps: ${failed.join(", ") || "none"}; degraded sources: ${result.degraded.join(", ") || "none"}`,
  );
  await client.end();
  process.exit(1);
}

await client.end();
