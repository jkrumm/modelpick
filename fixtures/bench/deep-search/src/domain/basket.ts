import type { OrderLine } from "./line.ts";
import { lineTotal } from "./line.ts";

/** The net total of a basket, in cents. */
export function basketTotal(lines: OrderLine[]): number {
  return lines.reduce((total, line) => total + lineTotal(line), 0);
}

/** True when the basket qualifies for free shipping. */
export function qualifiesForFreeShipping(lines: OrderLine[]): boolean {
  return basketTotal(lines) >= 5_000;
}
