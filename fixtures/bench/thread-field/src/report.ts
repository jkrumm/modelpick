import type { Order } from "./types.ts";

/** Renders integer cents as a German-style euro string: `1999` -> `"19,99 €"`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}${Math.floor(absolute / 100)},${remainder} €`;
}

/** One report line per order. */
export function orderLine(order: Order): string {
  return `${order.id} | ${order.customerName} | ${formatCents(order.totalCents)}`;
}
