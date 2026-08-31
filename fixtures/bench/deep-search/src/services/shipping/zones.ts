import { zoneFor } from "../../domain/country.ts";

/** The surcharge, in cents, a shipping zone adds. */
export function zoneSurcharge(countryCode: string): number {
  const zone = zoneFor(countryCode);
  if (zone === "world") return 2_500;
  if (zone === "eu-far") return 900;
  if (zone === "eu-near") return 400;
  return 0;
}
