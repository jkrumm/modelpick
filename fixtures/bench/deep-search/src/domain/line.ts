/** A single position on an order. */
export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

/** The total for one line, in cents. */
export function lineTotal(line: OrderLine): number {
  return line.quantity * line.unitPriceCents;
}
