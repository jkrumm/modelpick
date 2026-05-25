import { describe, it, expect } from "vitest";
import { normalizeMetrics } from "../server/scoring/normalize.js";
import { CATEGORY_WEIGHTS, scoreModels } from "../server/scoring/score.js";
import type { ModelMetrics } from "../server/scoring/normalize.js";

// ── normalizeMetrics ──────────────────────────────────────────────────────────

describe("normalizeMetrics", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeMetrics([])).toEqual([]);
  });

  it("returns single model with quality=1.0 when only one data point", () => {
    const result = normalizeMetrics([
      { model_id: "model-a", metric: "quality", value: 75, confidence: 1.0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quality).toBe(1.0);
    expect(result[0]?.cost).toBeNull();
    expect(result[0]?.speed).toBeNull();
  });

  it("assigns higher quality score to the model with higher raw quality", () => {
    const result = normalizeMetrics([
      { model_id: "high", metric: "quality", value: 90, confidence: 1.0 },
      { model_id: "low", metric: "quality", value: 50, confidence: 1.0 },
    ]);
    const high = result.find((m) => m.model_id === "high");
    const low = result.find((m) => m.model_id === "low");
    expect(high?.quality).toBeGreaterThan(low?.quality ?? Infinity);
    expect(high?.quality).toBeCloseTo(1.0);
    expect(low?.quality).toBeCloseTo(0.0);
  });

  it("assigns higher cost score to the cheaper model (inverted price)", () => {
    const result = normalizeMetrics([
      { model_id: "cheap", metric: "price_in", value: 1.0, confidence: 1.0 },
      { model_id: "pricey", metric: "price_in", value: 10.0, confidence: 1.0 },
    ]);
    const cheap = result.find((m) => m.model_id === "cheap");
    const pricey = result.find((m) => m.model_id === "pricey");
    expect(cheap?.cost).toBeGreaterThan(pricey?.cost ?? Infinity);
    expect(cheap?.cost).toBeCloseTo(1.0);
    expect(pricey?.cost).toBeCloseTo(0.0);
  });

  it("assigns higher speed score to the model with higher throughput", () => {
    const result = normalizeMetrics([
      { model_id: "fast", metric: "throughput", value: 120, confidence: 1.0 },
      { model_id: "slow", metric: "throughput", value: 40, confidence: 1.0 },
    ]);
    const fast = result.find((m) => m.model_id === "fast");
    const slow = result.find((m) => m.model_id === "slow");
    expect(fast?.speed).toBeGreaterThan(slow?.speed ?? Infinity);
    expect(fast?.speed).toBeCloseTo(1.0);
    expect(slow?.speed).toBeCloseTo(0.0);
  });

  it("inverts latency so lower latency yields higher speed score", () => {
    const result = normalizeMetrics([
      { model_id: "quick", metric: "latency_p50", value: 0.1, confidence: 1.0 },
      { model_id: "laggy", metric: "latency_p50", value: 2.0, confidence: 1.0 },
    ]);
    const quick = result.find((m) => m.model_id === "quick");
    const laggy = result.find((m) => m.model_id === "laggy");
    expect(quick?.speed).toBeGreaterThan(laggy?.speed ?? Infinity);
  });

  it("applies confidence-weighted averaging across sources", () => {
    // Two quality measurements: value=80 with confidence=0.9, value=100 with confidence=0.1
    // Weighted avg = (80*0.9 + 100*0.1) / (0.9+0.1) = 82.0
    const result = normalizeMetrics([
      { model_id: "model-a", metric: "quality", value: 80, confidence: 0.9 },
      { model_id: "model-a", metric: "quality", value: 100, confidence: 0.1 },
      { model_id: "model-b", metric: "quality", value: 50, confidence: 1.0 },
    ]);
    // model-a raw quality = 82, model-b = 50
    // Normalized: model-a = (82-50)/(82-50) = 1.0, model-b = 0.0
    const a = result.find((m) => m.model_id === "model-a");
    const b = result.find((m) => m.model_id === "model-b");
    expect(a?.quality).toBeCloseTo(1.0);
    expect(b?.quality).toBeCloseTo(0.0);
  });

  it("averages price_in and price_out into a single cost dimension", () => {
    // Model A: price_in=1, price_out=1 → cheapest across both metrics
    // Model B: price_in=10, price_out=10 → most expensive
    const result = normalizeMetrics([
      { model_id: "cheap", metric: "price_in", value: 1, confidence: 1.0 },
      { model_id: "cheap", metric: "price_out", value: 1, confidence: 1.0 },
      { model_id: "pricey", metric: "price_in", value: 10, confidence: 1.0 },
      { model_id: "pricey", metric: "price_out", value: 10, confidence: 1.0 },
    ]);
    const cheap = result.find((m) => m.model_id === "cheap");
    const pricey = result.find((m) => m.model_id === "pricey");
    expect(cheap?.cost).toBeGreaterThan(pricey?.cost ?? Infinity);
    expect(cheap?.cost).toBeCloseTo(1.0);
    expect(pricey?.cost).toBeCloseTo(0.0);
  });

  it("produces null dimensions for models with no data in that dimension", () => {
    const result = normalizeMetrics([
      { model_id: "llm-a", metric: "quality", value: 80, confidence: 1.0 },
      { model_id: "tts-b", metric: "price_in", value: 5, confidence: 1.0 },
    ]);
    const a = result.find((m) => m.model_id === "llm-a");
    const b = result.find((m) => m.model_id === "tts-b");
    // llm-a has no price data → cost = null
    expect(a?.cost).toBeNull();
    expect(a?.speed).toBeNull();
    // tts-b has no quality data → quality = null
    expect(b?.quality).toBeNull();
  });

  it("returns 0.0 for all models when all have the same metric value (no range)", () => {
    const result = normalizeMetrics([
      { model_id: "a", metric: "quality", value: 75, confidence: 1.0 },
      { model_id: "b", metric: "quality", value: 75, confidence: 1.0 },
    ]);
    expect(result.find((m) => m.model_id === "a")?.quality).toBe(0.0);
    expect(result.find((m) => m.model_id === "b")?.quality).toBe(0.0);
  });

  it("all normalized scores stay within [0, 1]", () => {
    const inputs = [
      { model_id: "a", metric: "quality", value: 95.3, confidence: 0.9 },
      { model_id: "b", metric: "quality", value: 62.1, confidence: 0.8 },
      { model_id: "c", metric: "quality", value: 44.7, confidence: 1.0 },
      { model_id: "a", metric: "price_in", value: 3.0, confidence: 0.9 },
      { model_id: "b", metric: "price_in", value: 15.0, confidence: 0.9 },
      { model_id: "c", metric: "price_in", value: 0.5, confidence: 0.9 },
      { model_id: "a", metric: "throughput", value: 88.0, confidence: 0.9 },
      { model_id: "b", metric: "throughput", value: 42.0, confidence: 0.9 },
    ];
    const result = normalizeMetrics(inputs);
    for (const m of result) {
      if (m.quality !== null) {
        expect(m.quality).toBeGreaterThanOrEqual(0);
        expect(m.quality).toBeLessThanOrEqual(1);
      }
      if (m.cost !== null) {
        expect(m.cost).toBeGreaterThanOrEqual(0);
        expect(m.cost).toBeLessThanOrEqual(1);
      }
      if (m.speed !== null) {
        expect(m.speed).toBeGreaterThanOrEqual(0);
        expect(m.speed).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ── scoreModels ───────────────────────────────────────────────────────────────

describe("scoreModels", () => {
  it("scores a single model as the weighted sum of its dimensions", () => {
    const metrics: ModelMetrics[] = [
      { model_id: "a", quality: 0.8, coding: 0.8, cost: 0.6, speed: 0.4 },
    ];
    const weights = { quality: 0.5, cost: 0.3, speed: 0.2 };
    const result = scoreModels(metrics, weights);
    // 0.5*0.8 + 0.3*0.6 + 0.2*0.4 = 0.40 + 0.18 + 0.08 = 0.66
    expect(result[0]?.score).toBeCloseTo(0.66);
  });

  it("treats null dimensions as 0 in scoring", () => {
    const metrics: ModelMetrics[] = [
      { model_id: "a", quality: 1.0, coding: 1.0, cost: null, speed: null },
    ];
    const weights = CATEGORY_WEIGHTS["orchestrator"];
    const result = scoreModels(metrics, weights);
    // score = 0.88 * 1.0 + 0.04 * 0 + 0.08 * 0 = 0.88
    expect(result[0]?.score).toBeCloseTo(0.88);
  });

  it("returns models sorted highest score first", () => {
    const metrics: ModelMetrics[] = [
      { model_id: "low", quality: 0.2, coding: 0.2, cost: 0.2, speed: 0.2 },
      { model_id: "high", quality: 0.8, coding: 0.8, cost: 0.8, speed: 0.8 },
      { model_id: "mid", quality: 0.5, coding: 0.5, cost: 0.5, speed: 0.5 },
    ];
    const result = scoreModels(metrics, { quality: 0.4, cost: 0.3, speed: 0.3 });
    expect(result[0]?.model_id).toBe("high");
    expect(result[1]?.model_id).toBe("mid");
    expect(result[2]?.model_id).toBe("low");
  });

  // The key test: weight profile determines the winner when models have different tradeoffs.
  // model-x: high quality (1.0), low cost (0.0), low speed (0.0)
  // model-y: low quality (0.0), high cost (1.0), high speed (1.0)
  const tradeoffMetrics: ModelMetrics[] = [
    { model_id: "model-x", quality: 1.0, coding: 1.0, cost: 0.0, speed: 0.0 },
    { model_id: "model-y", quality: 0.0, coding: 0.0, cost: 1.0, speed: 1.0 },
  ];

  it("quality-heavy weights (orchestrator) favor the high-quality model", () => {
    const scored = scoreModels(tradeoffMetrics, CATEGORY_WEIGHTS["orchestrator"]);
    // model-x: 0.88*1 + 0.04*0 + 0.08*0 = 0.88
    // model-y: 0.88*0 + 0.04*1 + 0.08*1 = 0.12
    expect(scored[0]?.model_id).toBe("model-x");
    expect(scored[0]?.score).toBeCloseTo(0.88);
  });

  it("scores on the coding dimension when qualityDim='coding'", () => {
    // smart generalist vs strong coder: coding dim must flip the winner
    const metrics: ModelMetrics[] = [
      { model_id: "generalist", quality: 1.0, coding: 0.3, cost: 0.0, speed: 0.0 },
      { model_id: "coder", quality: 0.3, coding: 1.0, cost: 0.0, speed: 0.0 },
    ];
    const weights = CATEGORY_WEIGHTS["coding"];
    expect(scoreModels(metrics, weights, "quality")[0]?.model_id).toBe("generalist");
    expect(scoreModels(metrics, weights, "coding")[0]?.model_id).toBe("coder");
  });

  it("speed+cost-heavy weights (fast) favor the fast/cheap model", () => {
    const scored = scoreModels(tradeoffMetrics, CATEGORY_WEIGHTS["fast"]);
    // model-x: 0.25*1 + 0.40*0 + 0.35*0 = 0.25
    // model-y: 0.25*0 + 0.40*1 + 0.35*1 = 0.75
    expect(scored[0]?.model_id).toBe("model-y");
    expect(scored[0]?.score).toBeCloseTo(0.75);
  });

  it("custom weight override changes ranking", () => {
    const customWeights = { quality: 0.1, cost: 0.1, speed: 0.8 };
    const scored = scoreModels(tradeoffMetrics, customWeights);
    // model-x: 0.1*1 + 0.1*0 + 0.8*0 = 0.10
    // model-y: 0.1*0 + 0.1*1 + 0.8*1 = 0.90
    expect(scored[0]?.model_id).toBe("model-y");
    expect(scored[0]?.score).toBeCloseTo(0.9);
  });

  it("all five categories have predefined weights that sum to 1", () => {
    const categories = ["fast", "coding", "orchestrator", "tts", "stt"] as const;
    for (const cat of categories) {
      const w = CATEGORY_WEIGHTS[cat];
      expect(w.quality + w.cost + w.speed).toBeCloseTo(1.0);
    }
  });

  it("returns empty array for empty input", () => {
    expect(scoreModels([], CATEGORY_WEIGHTS["fast"])).toEqual([]);
  });
});

// ── end-to-end: normalizeMetrics + scoreModels ────────────────────────────────

describe("normalize → score pipeline", () => {
  it("orchestrator picks the high-quality model", () => {
    // model-x: quality=100, price=10, throughput=10 → quality wins
    // model-y: quality=50,  price=1,  throughput=100 → cost+speed wins
    const inputs = [
      { model_id: "model-x", metric: "quality", value: 100, confidence: 1.0 },
      { model_id: "model-x", metric: "price_in", value: 10, confidence: 1.0 },
      { model_id: "model-x", metric: "throughput", value: 10, confidence: 1.0 },
      { model_id: "model-y", metric: "quality", value: 50, confidence: 1.0 },
      { model_id: "model-y", metric: "price_in", value: 1, confidence: 1.0 },
      { model_id: "model-y", metric: "throughput", value: 100, confidence: 1.0 },
    ];
    const normalized = normalizeMetrics(inputs);
    const scored = scoreModels(normalized, CATEGORY_WEIGHTS["orchestrator"]);
    expect(scored[0]?.model_id).toBe("model-x");
  });

  it("fast picks the fast/cheap model", () => {
    const inputs = [
      { model_id: "model-x", metric: "quality", value: 100, confidence: 1.0 },
      { model_id: "model-x", metric: "price_in", value: 10, confidence: 1.0 },
      { model_id: "model-x", metric: "throughput", value: 10, confidence: 1.0 },
      { model_id: "model-y", metric: "quality", value: 50, confidence: 1.0 },
      { model_id: "model-y", metric: "price_in", value: 1, confidence: 1.0 },
      { model_id: "model-y", metric: "throughput", value: 100, confidence: 1.0 },
    ];
    const normalized = normalizeMetrics(inputs);
    const scored = scoreModels(normalized, CATEGORY_WEIGHTS["fast"]);
    expect(scored[0]?.model_id).toBe("model-y");
  });
});
