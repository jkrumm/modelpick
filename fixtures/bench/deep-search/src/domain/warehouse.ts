/** A warehouse the storefront can ship from. */
export interface Warehouse {
  code: string;
  countryCode: string;
}

/** The warehouse that serves a country, falling back to the hub. */
export function warehouseFor(countryCode: string): Warehouse {
  if (countryCode === "CH") return { code: "ZRH", countryCode: "CH" };
  if (countryCode === "GB") return { code: "MAN", countryCode: "GB" };
  return { code: "HUB", countryCode: "DE" };
}
