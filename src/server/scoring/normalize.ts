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
  quality: number | null; // 0-1, higher = better (general intelligence index)
  coding: number | null; // 0-1, higher = better (coding index, falls back to quality)
  cost: number | null; // 0-1, higher = cheaper
  speed: number | null; // 0-1, higher = faster
}

function weightedAverage(values: { value: number; confidence: number }[]): number | null {
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

// Price spans orders of magnitude ($0.15 → $168), so linear min-max lets a few
// ultra-premium models compress everything else near "cheap". Normalize on a log
// scale instead so a 10× price difference is a constant step at any magnitude.
function minmaxLog(values: (number | null)[]): (number | null)[] {
  return minmax(values.map((v) => (v === null ? null : Math.log10(Math.max(v, 0.01)))));
}

// Time-to-first-token above this is reasoning/thinking time, not interactive
// latency — clip it so a 175s benchmark doesn't flatten the sub-2s field together.
const LATENCY_CLIP_S = 10;

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

  // A non-positive price / latency / throughput is missing data (no model is free
  // or has 0s time-to-first-token) — drop it so it isn't read as best-in-class.
  const POSITIVE_ONLY = new Set(["price_in", "price_out", "throughput", "latency_p50", "ttft_ms"]);

  // Group by model_id → metric → [(value, confidence)]
  const grouped = new Map<string, Map<string, { value: number; confidence: number }[]>>();
  for (const m of rawMetrics) {
    if (POSITIVE_ONLY.has(m.metric) && m.value <= 0) continue;
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
  const rawQuality = modelIds.map((id) => weightedAverage(grouped.get(id)?.get("quality") ?? []));
  const rawCoding = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("coding_index") ?? []),
  );
  const rawPriceIn = modelIds.map((id) => weightedAverage(grouped.get(id)?.get("price_in") ?? []));
  const rawPriceOut = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("price_out") ?? []),
  );
  const rawThroughput = modelIds.map((id) =>
    weightedAverage(grouped.get(id)?.get("throughput") ?? []),
  );
  // Latency: prefer our own live time-to-first-token over the leaderboard's
  // latency_p50. Leaderboards measure their own infra, not IU's, and have been
  // wrong here by 3-4x (GLM-5.2: AA 141 tok/s vs 37.7 measured) — while a model
  // we never benchmarked keeps whatever the leaderboard says. ttft_ms is in
  // milliseconds; latency_p50 is in seconds.
  const rawLatency = modelIds.map((id) => {
    const live = weightedAverage(grouped.get(id)?.get("ttft_ms") ?? []);
    if (live !== null) return live / 1000;
    return weightedAverage(grouped.get(id)?.get("latency_p50") ?? []);
  });

  // Min-max normalize across models
  const normQuality = minmax(rawQuality);
  const normCoding = minmax(rawCoding);
  const normPriceIn = minmaxLog(rawPriceIn);
  const normPriceOut = minmaxLog(rawPriceOut);
  const normThroughput = minmax(rawThroughput);
  const normLatency = minmax(
    rawLatency.map((v) => (v === null ? null : Math.min(v, LATENCY_CLIP_S))),
  );

  return modelIds.map((model_id, i) => {
    // Quality: higher = better (direct)
    const quality = normQuality[i] ?? null;

    // Coding quality: dedicated coding index, falling back to general quality so
    // models the leaderboard scores for intelligence but not coding still rank.
    const coding = normCoding[i] ?? quality;

    // Cost: invert normalized price; average price_in and price_out when both available
    const cost = combineTwo(inv(normPriceIn[i]), inv(normPriceOut[i]));

    // Speed: responsiveness-led. Time-to-first-token (inverted latency) matters
    // more than raw throughput for interactive use, so weight it 60% / 40%.
    const normTp = normThroughput[i] ?? null;
    const invLat = inv(normLatency[i]);
    let speed: number | null;
    if (normTp !== null && invLat !== null) {
      speed = 0.6 * invLat + 0.4 * normTp;
    } else {
      speed = invLat ?? normTp;
    }

    return { model_id, quality, coding, cost, speed };
  });
}
