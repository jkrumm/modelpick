export interface PricePoint {
  value: number;
  confidence: number;
}

/** Source whose list price wins when it covers the model. */
const PREFERRED_PRICE_SOURCE = "modelsdev";

export function weightedAverage(values: PricePoint[]): number | null {
  if (values.length === 0) return null;
  const totalWeight = values.reduce((sum, v) => sum + v.confidence, 0);
  if (totalWeight === 0) {
    return values.reduce((sum, v) => sum + v.value, 0) / values.length;
  }
  return values.reduce((sum, v) => sum + v.value * v.confidence, 0) / totalWeight;
}

/**
 * The one list-price precedence for a single side (input or output) of one model:
 * a measured IU rate when the caller has one, else models.dev when it covers the
 * model, else the confidence-weighted mean of every other source (AA, OpenRouter),
 * else null. Non-positive points are missing data (nothing is free), so they never
 * count, and a models.dev point that is non-positive falls through to the others.
 */
export function resolveListPrice(
  bySource: ReadonlyMap<string, PricePoint[]> | undefined,
  measuredIu?: number | null,
): number | null {
  if (measuredIu !== null && measuredIu !== undefined) return measuredIu;
  if (bySource === undefined) return null;
  const preferred = (bySource.get(PREFERRED_PRICE_SOURCE) ?? []).filter((p) => p.value > 0);
  if (preferred.length > 0) return weightedAverage(preferred);
  return weightedAverage([...bySource.values()].flat().filter((p) => p.value > 0));
}
