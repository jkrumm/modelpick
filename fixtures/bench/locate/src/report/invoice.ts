import type { Order } from "../orders/types.ts";
import { formatCentsAsEuro, formatQuantity } from "./currency.ts";
import { lineTotalCents, orderNetCents } from "../orders/total.ts";
import { netAfterDiscountCents } from "../orders/discount.ts";
import { grossCents } from "../money/tax.ts";

/** One printable line per order position. */
export function invoiceLines(order: Order): string[] {
  return order.lines.map(
    (line) => `${formatQuantity(line.quantity)} ${line.sku}  ${formatCentsAsEuro(lineTotalCents(line))}`,
  );
}

/** The printable footer of an invoice. */
export function invoiceFooter(order: Order): string {
  const net = netAfterDiscountCents(orderNetCents(order), order.discountRatio);
  return `Total ${formatCentsAsEuro(grossCents(net))}`;
}
