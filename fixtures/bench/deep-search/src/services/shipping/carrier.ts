import type { WeightBand } from "../../domain/weight.ts";

/** A carrier and what it charges before surcharges. */
export interface Carrier {
  name: string;
  baseCents: number;
}

/** The carrier that handles a weight band. */
export function carrierFor(band: WeightBand): Carrier {
  if (band.name === "bulk") return { name: "Freight", baseCents: 1900 };
  if (band.name === "heavy") return { name: "Parcel", baseCents: 890 };
  return { name: "Letter", baseCents: 320 };
}
