import { clampRatio } from "../util/clamp.ts";

/** The discount owed on a net amount, in cents. */
export function discountCents(netCents: number, ratio: number): number {
  return Math.round(netCents * clampRatio(ratio));
}
