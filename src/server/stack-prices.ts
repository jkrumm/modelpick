import { resolveListPrice } from "./scoring/list-price.js";
import type { PricePoint } from "./scoring/list-price.js";

export interface PriceMetricRow {
  model_id: string;
  source: string;
  metric: string;
  value: number;
  confidence: number | null;
}

export interface MeasuredRateRow {
  model_id: string;
  price_in_per_m: number | null;
  price_out_per_m: number | null;
}

export type StackPrices = Map<string, { in: number | null; out: number | null }>;

/**
 * USD per 1M tokens per model for STACK.md, resolved by the same `resolveListPrice`
 * the scorer uses, with the measured IU rate (solved from usage.cost) overriding.
 */
export function resolveStackPrices(
  metrics: readonly PriceMetricRow[],
  measured: readonly MeasuredRateRow[],
): StackPrices {
  const points = new Map<string, { in: Map<string, PricePoint[]>; out: Map<string, PricePoint[]> }>();
  for (const m of metrics) {
    if (m.metric !== "price_in" && m.metric !== "price_out") continue;
    const entry = points.get(m.model_id) ?? { in: new Map(), out: new Map() };
    const bySource = m.metric === "price_in" ? entry.in : entry.out;
    const list = bySource.get(m.source) ?? [];
    list.push({ value: m.value, confidence: m.confidence ?? 1.0 });
    bySource.set(m.source, list);
    points.set(m.model_id, entry);
  }

  const rates = new Map(measured.map((r) => [r.model_id, r]));
  const prices: StackPrices = new Map();
  for (const id of new Set([...points.keys(), ...rates.keys()])) {
    const entry = points.get(id);
    const rate = rates.get(id);
    prices.set(id, {
      in: resolveListPrice(entry?.in, rate?.price_in_per_m),
      out: resolveListPrice(entry?.out, rate?.price_out_per_m),
    });
  }
  return prices;
}
