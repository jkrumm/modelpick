import { db as defaultDb } from "../db/index.js";
import { metricSnapshot } from "../db/schema.js";
import type { NormalizedMetric } from "./collectors/normalize.js";

// SQLite caps bound variables per statement (32766); one multi-row insert of every collector's
// metrics (per-effort Epoch rows included, 6 columns each) went past it.
const CHUNK = 500;

/** Appends collector metrics to `metric_snapshot`, in chunks. */
export async function insertMetrics(
  metrics: readonly NormalizedMetric[],
  db: typeof defaultDb = defaultDb,
): Promise<void> {
  for (let i = 0; i < metrics.length; i += CHUNK) {
    await db.insert(metricSnapshot).values(
      metrics.slice(i, i + CHUNK).map((m) => ({
        model_id: m.model_id,
        source: m.source,
        metric: m.metric,
        value: m.value,
        confidence: m.confidence,
        conditions: m.conditions ?? null,
      })),
    );
  }
}
