/** Rounds a euro amount to whole cents, half away from zero. */
export function roundToCents(euro: number): number {
  return Math.round(euro * 100) / 100;
}

/** Rounds a cent amount to the nearest 5 cents. */
export function roundToNickel(cents: number): number {
  return Math.round(cents / 5) * 5;
}
