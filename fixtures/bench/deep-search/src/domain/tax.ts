/** The standard VAT rate for a country, as a ratio. */
export function vatRate(countryCode: string): number {
  if (countryCode === "DE") return 0.19;
  if (countryCode === "AT") return 0.2;
  if (countryCode === "CH") return 0.081;
  return 0;
}

/** The VAT owed on a net amount, in cents. */
export function vatCents(netCents: number, countryCode: string): number {
  return Math.round(netCents * vatRate(countryCode));
}
