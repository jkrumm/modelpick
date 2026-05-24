import { clamp } from "./utils.js";

// Accepts both NormalizedMetric (collectors) and MetricSnapshot (DB reads)
export interface MetricInput {
  model_id: string;
  metric: string;
  value: number;
  confidence: number | null;
}

export interface ModelMetrics {
  model_id: string;
  quality: number | null; // 0-1, higher = better
  cost: number | null; // 0-1, higher = cheaper
  speed: number | null; // 0-1, higher = faster
}

function weightedAverage(
  values: { value: number; confidence: number }[],
): number | null {
  if (values.length === 0) return null;
  const totalWeight = values.reduce((sum, v) => sum + v.confidence, 0);
  if (totalWeight === 0) {
    return values.reduce((sum, v) => sum + v.value, 0) / values.length;
  }
  return values.reduce((sum, v) => sum + v.value * v.confidence, 0) / totalWeight;
}

function minmax(values: (number | null)[]): (number | null)[] {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return values;
  if (nonNull.length === 1) return values.map((v) => (v !== null ? 1.0 : null));
  const min = Math.min(...nonNull);
  const max = Math.max(...nonNull);
  if (max === min) return values.map((v) => (v !== null ? 0.0 : null));
  return values.map((v) => (v !== null ? clamp((v - min) / (max - min), 0, 1) : null));
}

function inv(v: number | null | undefined): number | null {
  return v !== null && v !== undefined ? 1 - v : null;
}

function combineTwo(a: number | null | undefined, b: number | null | undefined): number | null {
  const av = a ?? null;
  const bv = b ?? null;
  if (av !== null && bv !== null) return (av + bv) / 2;
  return av ?? bv;
}

export function normalizeMetrics(rawMetrics: MetricInput[]): ModelMetrics[] {
  if (rawMetrics.length === 0) return [];

  // Group by model_id → metric → [(value, confidence)]
  const grouped = new Map<string, Map<string, { value: number; confidence: number }[]>>();
  for (const m of rawMetrics) {
    let byMetric = grouped.get(m.model_id);
    if (byMetric === undefined) {
      byMetric = new Map();
      grouped.set(m.model_id, byMetric);
    }
    let entries = byMetric.get(m.metric);
    if (entries === undefined) {
      entries = [];
      byMetric.set(m.metric, entries);
    }
    entries.push({ value: m.value, confidence: m.confidence ?? 1.0 });
  }

  const modelIds = [...grouped.keys()];

  // Confidence-weighted average per (model, raw metric)
  const rawQuality = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("quality") ?? []),
  );
  const rawPriceIn = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("price_in") ?? []),
  );
  const rawPriceOut = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("price_out") ?? []),
  );
  const rawThroughput = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("throughput") ?? []),
  );
  const rawLatency = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("latency_p50") ?? []),
  );

  // Min-max normalize across models
  const normQuality = minmax(rawQuality);
  const normPriceIn = minmax(rawPriceIn);
  const normPriceOut = minmax(rawPriceOut);
  const normThroughput = minmax(rawThroughput);
  const normLatency = minmax(rawLatency);

  return modelIds.map((model_id, i) => {
    // Quality: higher = better (direct)
    const quality = normQuality[i] ?? null;

    // Cost: invert normalized price; average price_in and price_out when both available
    const cost = combineTwo(inv(normPriceIn[i]), inv(normPriceOut[i]));

    // Speed: throughput higher = better (direct); latency lower = better (invert)
    // Weight throughput 60%, inverted latency 40% when both available
    const normTp = normThroughput[i] ?? null;
    const invLat = inv(normLatency[i]);
    let speed: number | null;
    if (normTp !== null && invLat !== null) {
      speed = 0.6 * normTp + 0.4 * invLat;
    } else {
      speed = normTp ?? invLat;
    }

    return { model_id, quality, cost, speed };
  });
}
