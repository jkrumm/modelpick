import { lineTotal } from "../../domain/line.ts";
import type { OrderLine } from "../../domain/line.ts";

/** The invoice total for `lines`, in cents. */
export function invoiceTotal(lines: OrderLine[]): number {
  return lines.reduce((total, line) => total + lineTotal(line), 0);
}
