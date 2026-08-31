/** The shipping zone a country belongs to. */
export function zoneFor(countryCode: string): string {
  if (countryCode === "DE") return "domestic";
  if (["AT", "BE", "FR", "NL", "PL"].includes(countryCode)) return "eu-near";
  if (["ES", "FI", "IT", "PT", "SE"].includes(countryCode)) return "eu-far";
  return "world";
}
