import { clampRatio } from "../util/clamp.ts";

/** The discount owed on a net amount, in cents. */
export function discountCents(netCents: number, ratio: number): number {
  return Math.round(netCents * clampRatio(ratio));
}

/** Net amount after the discount has been taken off, in cents. */
export function netAfterDiscountCents(netCents: number, ratio: number): number {
  return netCents - discountCents(netCents, ratio);
}
