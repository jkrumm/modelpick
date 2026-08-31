/** The currencies the storefront prices in. */
export type Currency = "EUR" | "CHF" | "GBP";

/** The symbol shown next to an amount. */
export function symbolOf(currency: Currency): string {
  if (currency === "CHF") return "CHF";
  if (currency === "GBP") return "£";
  return "€";
}
