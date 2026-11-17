import { db } from "../../db/index.js";
import { and, eq, inArray } from "drizzle-orm";
import { aaVariant, metricSnapshot, models } from "../../db/schema.js";
import { getLatestProbes } from "../../db/queries.js";
import { loadAgwRoutes } from "./agw-routes.js";
import { buildEfficiency } from "./build.js";
import { CODING_BENCHMARKS } from "./coding.js";
import type { EfficiencyResponse } from "./types.js";

/** The /api/efficiency payload from SQLite plus the (cached) agw route table. */
export async function loadEfficiency(): Promise<EfficiencyResponse> {
  const codingMetrics = CODING_BENCHMARKS.flatMap((b) =>
    [b.metric, b.costMetric, b.tokensMetric].filter((m): m is string => m !== undefined),
  );
  const [variants, modelRows, probes, routes, epochRows] = await Promise.all([
    db.select().from(aaVariant),
    db.select().from(models),
    getLatestProbes(),
    loadAgwRoutes(),
    db
      .select({
        id: metricSnapshot.id,
        model_id: metricSnapshot.model_id,
        metric: metricSnapshot.metric,
        conditions: metricSnapshot.conditions,
        value: metricSnapshot.value,
        captured_at: metricSnapshot.captured_at,
      })
      .from(metricSnapshot)
      .where(and(eq(metricSnapshot.source, "epoch"), inArray(metricSnapshot.metric, codingMetrics))),
  ]);
  return buildEfficiency({
    variants,
    models: modelRows,
    probes: new Map(Object.entries(probes).map(([id, p]) => [id, p.accessible])),
    routes: routes.routes,
    routesError: routes.error,
    epochRows,
  });
}
