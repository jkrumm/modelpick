import { padCents } from "../util/pad.ts";

/**
 * Renders an integer amount of cents as a German-style euro string:
 * `1234` -> `"12,34 €"`, `-50` -> `"-0,50 €"`.
 */
export function formatCentsAsEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${padCents(absolute % 100)} €`;
}

/** Renders a quantity with its unit suffix, e.g. `3` -> `"3 x"`. */
export function formatQuantity(quantity: number): string {
  return `${quantity} x`;
}
