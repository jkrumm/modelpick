import { desc } from "drizzle-orm";
import { db as defaultDb } from "../../db/index.js";
import { aaVariant, models, releaseAlert } from "../../db/schema.js";
import { getLatestProbes } from "../../db/queries.js";
import { publish } from "./ntfy.js";
import type { ReleaseAlertDeps } from "./releases.js";

/** Production wiring of the release alerts: SQLite for state, ntfy for delivery. */
export function createReleaseAlertDeps(db: typeof defaultDb = defaultDb): ReleaseAlertDeps {
  return {
    async load() {
      const [variants, modelRows, probes, alerted] = await Promise.all([
        db.select().from(aaVariant).orderBy(desc(aaVariant.release_date)),
        db.select().from(models),
        getLatestProbes(),
        db.select({ lineage: releaseAlert.lineage }).from(releaseAlert),
      ]);
      return {
        variants,
        models: modelRows,
        probes: new Map(Object.entries(probes).map(([id, p]) => [id, p.accessible])),
        alerted: new Set(alerted.map((a) => a.lineage)),
      };
    },
    async record(rows) {
      if (rows.length === 0) return;
      for (let i = 0; i < rows.length; i += 100) {
        await db.insert(releaseAlert).values(rows.slice(i, i + 100)).onConflictDoNothing();
      }
    },
    publish,
  };
}
