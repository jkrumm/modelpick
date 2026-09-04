import { createServerFn } from "@tanstack/react-start";
import { desc } from "drizzle-orm";
import { db } from "~/db/index";
import { capabilityProbe } from "~/db/schema";
import { getLatestMetricsBySourceMetric, getModels } from "~/db/queries";
import { curate } from "~/server/curate";
import { normalizeMetrics } from "~/server/scoring/normalize";
import { metricKey } from "./-benchmarks-format";

export interface BenchmarkModelRow {
  model_id: string;
  display_name: string;
  provider: string;
  modality: string;
  accessible: boolean;
  /** Keyed by metricKey(source, metric) — see -benchmarks-format.ts. */
  metrics: Record<string, number>;
}

export interface BenchmarkMatrixData {
  rows: BenchmarkModelRow[];
  /** Representative model ids surfaced by the default "current only" view —
   *  same notion catalog.tsx uses, sourced from the same curate() call. */
  currentIds: string[];
}

export const getBenchmarkMatrixData = createServerFn({ method: "GET" }).handler(
  async (): Promise<BenchmarkMatrixData> => {
    const [allModels, latestMetrics, allProbes] = await Promise.all([
      getModels(),
      getLatestMetricsBySourceMetric(),
      db
        .select({
          model_id: capabilityProbe.model_id,
          accessible: capabilityProbe.accessible,
          checked_at: capabilityProbe.checked_at,
        })
        .from(capabilityProbe)
        .orderBy(desc(capabilityProbe.checked_at)),
    ]);

    // Latest accessibility per model — same "rows are newest-first, first hit
    // wins" dedup src/routes/-server-fns.ts uses, reimplemented locally since
    // that file's buildProbeMap isn't exported.
    const accessibleById = new Map<string, boolean>();
    for (const p of allProbes) {
      if (!accessibleById.has(p.model_id)) accessibleById.set(p.model_id, p.accessible);
    }

    // currentIds is the one real piece of logic here — imported from curate()
    // rather than reimplemented, per src/routes/-server-fns.ts's own pattern.
    const { currentIds } = curate(
      allModels.map((m) => ({ id: m.id, modality: m.modality })),
      normalizeMetrics(latestMetrics),
      (id) => accessibleById.get(id) ?? false,
    );

    const metricsByModel = new Map<string, Record<string, number>>();
    for (const m of latestMetrics) {
      let entry = metricsByModel.get(m.model_id);
      if (entry === undefined) {
        entry = {};
        metricsByModel.set(m.model_id, entry);
      }
      entry[metricKey(m.source, m.metric)] = m.value;
    }

    const rows: BenchmarkModelRow[] = allModels.map((m) => ({
      model_id: m.id,
      display_name: m.display_name,
      provider: m.provider,
      modality: m.modality,
      accessible: accessibleById.get(m.id) ?? false,
      metrics: metricsByModel.get(m.id) ?? {},
    }));

    return { rows, currentIds: [...currentIds] };
  },
);
