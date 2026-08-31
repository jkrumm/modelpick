import type { Order, OrderLine } from "./types.ts";
import { sumCents } from "../money/cents.ts";

/** Line subtotal in cents. */
export function lineTotalCents(line: OrderLine): number {
  return line.quantity * line.unitPriceCents;
}

/** Net order total in cents, before discount. */
export function orderNetCents(order: Order): number {
  return sumCents(order.lines.map(lineTotalCents));
}
