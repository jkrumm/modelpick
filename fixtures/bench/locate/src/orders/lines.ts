import type { Order, OrderLine } from "./types.ts";

/** Groups the lines of an order by SKU, summing quantities. */
export function mergeLines(order: Order): OrderLine[] {
  const bySku = new Map<string, OrderLine>();
  for (const line of order.lines) {
    const existing = bySku.get(line.sku);
    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }
    bySku.set(line.sku, { ...line });
  }
  return [...bySku.values()];
}

/** Total number of physical items on an order. */
export function itemCount(order: Order): number {
  return order.lines.reduce((count, line) => count + line.quantity, 0);
}
