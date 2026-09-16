import { createServerFn } from "@tanstack/react-start";
import type { MetricSnapshot, Model, Recommendation } from "~/db/schema";
import {
  getLatestMetrics,
  getLatestProbes,
  getLatestRecommendations,
  getModels,
} from "~/db/queries";
import type { ProbeSummary } from "~/db/queries";
import { normalizeMetrics } from "~/server/scoring/normalize";
import type { ModelMetrics } from "~/server/scoring/normalize";
import { curate } from "~/server/curate";

export type ProbeInfo = ProbeSummary;

// Raw metric value per model — for chart display (price_in, quality, throughput, etc.)
export type RawMetricMap = Record<string, Record<string, number>>;

export interface DeciderData {
  recommendations: Recommendation[];
  models: Model[];
  modelMetrics: ModelMetrics[];
  probes: Record<string, ProbeInfo>;
  rawMetrics: RawMetricMap;
  /** Representative model ids surfaced by the default "current only" view. */
  currentIds: string[];
  /** model id -> id of the newer-version sibling that superseded it. */
  supersededBy: Record<string, string>;
}

function deduplicateMetrics(rawMetrics: MetricSnapshot[]): MetricSnapshot[] {
  const seen = new Set<string>();
  const result: MetricSnapshot[] = [];
  for (const snap of rawMetrics) {
    const key = `${snap.model_id}|${snap.source}|${snap.metric}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(snap);
    }
  }
  return result;
}

function buildRawMetricMap(metrics: MetricSnapshot[]): RawMetricMap {
  const map: RawMetricMap = {};
  for (const m of metrics) {
    let byMetric = map[m.model_id];
    if (byMetric === undefined) {
      byMetric = {};
      map[m.model_id] = byMetric;
    }
    // Keep highest-confidence value; since metrics are already deduplicated, just set
    byMetric[m.metric] = m.value;
  }
  return map;
}

export const getDeciderData = createServerFn({ method: "GET" }).handler(
  async (): Promise<DeciderData> => {
    const [recs, allModels, rawMetrics, probes] = await Promise.all([
      getLatestRecommendations(),
      getModels(),
      getLatestMetrics(),
      getLatestProbes(),
    ]);

    const latestMetrics = deduplicateMetrics(rawMetrics);
    const rawMap = buildRawMetricMap(latestMetrics);

    // Propagate leaderboard data across catalog variants and pick the "current"
    // representative per model so default views drop dated pins and stale models.
    const {
      metrics: modelMetrics,
      currentIds,
      supersededBy,
    } = curate(
      allModels.map((m) => ({ id: m.id, modality: m.modality })),
      normalizeMetrics(latestMetrics),
      (id) => probes[id]?.accessible ?? false,
    );

    return {
      recommendations: recs,
      models: allModels,
      modelMetrics,
      probes,
      rawMetrics: rawMap,
      currentIds: [...currentIds],
      supersededBy: Object.fromEntries(supersededBy),
    };
  },
);
