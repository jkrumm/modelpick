/** A shipping weight band and what it adds to the carrier's base rate. */
export interface WeightBand {
  name: "light" | "heavy" | "bulk";
  surchargeCents: number;
}

/** The band a parcel weight falls into. */
export function bandFor(weightGrams: number): WeightBand {
  if (weightGrams > 10_000) return { name: "bulk", surchargeCents: 450 };
  if (weightGrams > 2_000) return { name: "heavy", surchargeCents: 180 };
  return { name: "light", surchargeCents: 0 };
}
