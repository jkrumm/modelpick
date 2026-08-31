import type { OrderLine } from "./line.ts";

/** A customer order as the services see it. */
export interface Order {
  id: string;
  customer: string;
  lines: OrderLine[];
}

/** How many physical items an order holds. */
export function itemCount(order: Order): number {
  return order.lines.reduce((count, line) => count + line.quantity, 0);
}
