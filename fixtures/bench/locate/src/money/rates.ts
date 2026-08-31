/** Static conversion rates against the euro. Refreshed by the nightly job. */
export const RATES: Record<string, number> = {
  EUR: 1,
  CHF: 0.94,
  USD: 1.08,
};

/** Converts an amount of cents from `currency` into euro cents. */
export function toEuroCents(cents: number, currency: string): number {
  const rate = RATES[currency];
  if (rate === undefined) {
    throw new TypeError(`unknown currency ${currency}`);
  }
  return Math.round(cents / rate);
}
