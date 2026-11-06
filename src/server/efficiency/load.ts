import { db } from "../../db/index.js";
import { aaVariant, models } from "../../db/schema.js";
import { getLatestProbes } from "../../db/queries.js";
import { loadAgwRoutes } from "./agw-routes.js";
import { buildEfficiency } from "./build.js";
import type { EfficiencyResponse } from "./types.js";

/** The /api/efficiency payload from SQLite plus the (cached) agw route table. */
export async function loadEfficiency(): Promise<EfficiencyResponse> {
  const [variants, modelRows, probes, routes] = await Promise.all([
    db.select().from(aaVariant),
    db.select().from(models),
    getLatestProbes(),
    loadAgwRoutes(),
  ]);
  return buildEfficiency({
    variants,
    models: modelRows,
    probes: new Map(Object.entries(probes).map(([id, p]) => [id, p.accessible])),
    routes: routes.routes,
    routesError: routes.error,
  });
}
