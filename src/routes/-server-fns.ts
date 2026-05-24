import { createServerFn } from "@tanstack/react-start";
import { desc } from "drizzle-orm";
import { db } from "~/db/index";
import { capabilityProbe } from "~/db/schema";
import type { MetricSnapshot, Model, ProbeStatus, Recommendation } from "~/db/schema";
import { getLatestMetrics, getLatestRecommendations, getModels } from "~/db/queries";
import { normalizeMetrics } from "~/server/scoring/normalize";
import type { ModelMetrics } from "~/server/scoring/normalize";

export interface ProbeInfo {
  accessible: boolean;
  probe_status: ProbeStatus;
  error: string | null;
  latency_ms: number | null;
  residency: "eu" | "us" | "unknown";
}

// Raw metric value per model — for chart display (price_in, quality, throughput, etc.)
export type RawMetricMap = Record<string, Record<string, number>>;

export interface DeciderData {
  recommendations: Recommendation[];
  models: Model[];
  modelMetrics: ModelMetrics[];
  probes: Record<string, ProbeInfo>;
  rawMetrics: RawMetricMap;
}

function buildProbeMap(
  allProbes: Array<{
    model_id: string;
    accessible: boolean;
    probe_status: ProbeStatus;
    error: string | null;
    latency_ms: number | null;
    residency: "eu" | "us" | "unknown";
    checked_at: string;
  }>,
): Record<string, ProbeInfo> {
  const map = new Map<string, ProbeInfo>();
  for (const p of allProbes) {
    if (!map.has(p.model_id)) {
      map.set(p.model_id, {
        accessible: p.accessible,
        probe_status: p.probe_status,
        error: p.error,
        latency_ms: p.latency_ms,
        residency: p.residency,
      });
    }
  }
  return Object.fromEntries(map);
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
    const [recs, allModels, rawMetrics, allProbes] = await Promise.all([
      getLatestRecommendations(),
      getModels(),
      getLatestMetrics(),
      db
        .select({
          model_id: capabilityProbe.model_id,
          accessible: capabilityProbe.accessible,
          probe_status: capabilityProbe.probe_status,
          error: capabilityProbe.error,
          latency_ms: capabilityProbe.latency_ms,
          residency: capabilityProbe.residency,
          checked_at: capabilityProbe.checked_at,
        })
        .from(capabilityProbe)
        .orderBy(desc(capabilityProbe.checked_at)),
    ]);

    const latestMetrics = deduplicateMetrics(rawMetrics);
    const modelMetrics = normalizeMetrics(latestMetrics);
    const probes = buildProbeMap(allProbes);
    const rawMap = buildRawMetricMap(latestMetrics);

    return {
      recommendations: recs,
      models: allModels,
      modelMetrics,
      probes,
      rawMetrics: rawMap,
    };
  },
);
