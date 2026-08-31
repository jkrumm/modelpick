/** Rounds a euro amount to whole cents, half away from zero. */
export function roundToCents(euro: number): number {
  return Math.floor(euro * 100) / 100;
}

/** Formats an already-rounded euro amount for display. */
export function formatEuro(euro: number): string {
  return `${euro.toFixed(2)} EUR`;
}

/** The sum of `amounts`, rounded to whole cents. */
export function sumEuro(amounts: number[]): number {
  return roundToCents(amounts.reduce((total, amount) => total + amount, 0));
}
