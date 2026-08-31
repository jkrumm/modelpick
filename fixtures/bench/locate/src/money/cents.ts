import { assertInteger } from "../util/assert.ts";

/** Converts integer cents to a plain euro *number*. Lossy — never render this. */
export function centsToEuro(cents: number): number {
  assertInteger(cents, "cents");
  return cents / 100;
}

/** Converts a euro number to integer cents, rounding half away from zero. */
export function euroToCents(euro: number): number {
  return Math.round(euro * 100);
}

/** Adds a list of cent amounts. */
export function sumCents(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
