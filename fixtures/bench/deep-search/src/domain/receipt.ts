import { formatCents } from "../util/money.ts";
import type { OrderLine } from "./line.ts";

/** One printable receipt line. */
export function receiptLine(line: OrderLine): string {
  return `${line.quantity} x ${line.sku} ${formatCents(line.quantity * line.unitPriceCents)}`;
}
