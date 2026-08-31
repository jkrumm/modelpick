import type { Order } from "../orders/types.ts";
import { formatEuroAmount, formatPercent } from "../money/format.ts";
import { centsToEuro } from "../money/cents.ts";
import { orderNetCents } from "../orders/total.ts";

/** A one-line dashboard summary, using decimal euros rather than cents. */
export function summaryLine(order: Order): string {
  const net = centsToEuro(orderNetCents(order));
  return `${order.id}: ${formatEuroAmount(net)} (-${formatPercent(order.discountRatio)})`;
}

/** Sorts orders by net value, descending. */
export function byValueDesc(orders: Order[]): Order[] {
  return orders.toSorted((a, b) => orderNetCents(b) - orderNetCents(a));
}
