import { canFulfil } from "../../domain/stock.ts";

/** The catalogue entries that can be fulfilled right now. */
export function availableItems(items: string[], onHand: Map<string, number>): string[] {
  return items.filter((item) => canFulfil(onHand.get(item) ?? 0, 0, 1));
}
