import { describe, expect, it } from "vitest";
import { resolveListPrice } from "../server/scoring/list-price.js";
import { resolveStackPrices } from "../server/stack-prices.js";
import { normalizeMetrics } from "../server/scoring/normalize.js";

const sources = (entries: Record<string, { value: number; confidence: number }[]>) =>
  new Map(Object.entries(entries));

describe("resolveListPrice", () => {
  it("models.dev wins over every other source", () => {
    const price = resolveListPrice(
      sources({
        modelsdev: [{ value: 2, confidence: 1 }],
        artificialanalysis: [{ value: 10, confidence: 1 }],
        openrouter: [{ value: 20, confidence: 1 }],
      }),
    );
    expect(price).toBe(2);
  });

  it("without models.dev, takes the confidence-weighted mean of the rest", () => {
    const price = resolveListPrice(
      sources({
        artificialanalysis: [{ value: 10, confidence: 3 }],
        openrouter: [{ value: 20, confidence: 1 }],
      }),
    );
    expect(price).toBeCloseTo(12.5);
  });

  it("is null with no data", () => {
    expect(resolveListPrice(undefined)).toBeNull();
    expect(resolveListPrice(new Map())).toBeNull();
  });

  it("a measured IU rate overrides models.dev when passed", () => {
    const map = sources({ modelsdev: [{ value: 2, confidence: 1 }] });
    expect(resolveListPrice(map, 0.5)).toBe(0.5);
    expect(resolveListPrice(undefined, 0.5)).toBe(0.5);
    expect(resolveListPrice(map, null)).toBe(2);
  });

  it("ignores non-positive points and falls through from a zero models.dev price", () => {
    const price = resolveListPrice(
      sources({
        modelsdev: [{ value: 0, confidence: 1 }],
        openrouter: [{ value: 4, confidence: 1 }],
      }),
    );
    expect(price).toBe(4);
  });
});

const row = (model_id: string, source: string, metric: string, value: number, confidence: number | null) => ({
  model_id,
  source,
  metric,
  value,
  confidence,
});

describe("resolveStackPrices", () => {
  it("uses the same weighted mean as the scorer, not an unweighted one", () => {
    const prices = resolveStackPrices(
      [
        row("m", "artificialanalysis", "price_in", 10, 3),
        row("m", "openrouter", "price_in", 20, 1),
        row("m", "openrouter", "price_out", 8, null),
      ],
      [],
    );
    expect(prices.get("m")).toEqual({ in: 12.5, out: 8 });
  });

  it("measured IU rates override per side and add models with no list price", () => {
    const prices = resolveStackPrices(
      [row("m", "modelsdev", "price_in", 2, 1), row("m", "modelsdev", "price_out", 6, 1)],
      [
        { model_id: "m", price_in_per_m: null, price_out_per_m: 5 },
        { model_id: "only-probed", price_in_per_m: 1, price_out_per_m: 3 },
      ],
    );
    expect(prices.get("m")).toEqual({ in: 2, out: 5 });
    expect(prices.get("only-probed")).toEqual({ in: 1, out: 3 });
  });

  it("agrees with normalizeMetrics on which model is cheaper", () => {
    const metrics = [
      row("cheap", "modelsdev", "price_in", 1, 1),
      row("cheap", "modelsdev", "price_out", 1, 1),
      row("dear", "modelsdev", "price_in", 100, 1),
      row("dear", "modelsdev", "price_out", 100, 1),
    ];
    const prices = resolveStackPrices(metrics, []);
    const cost = new Map(normalizeMetrics(metrics).map((m) => [m.model_id, m.cost]));
    expect(prices.get("cheap")!.in! < prices.get("dear")!.in!).toBe(true);
    expect(cost.get("cheap")!).toBeGreaterThan(cost.get("dear")!);
  });
});
