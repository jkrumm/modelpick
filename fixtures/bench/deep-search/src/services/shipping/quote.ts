import { maxParcelGrams } from "../../config/limits.ts";
import { bandFor } from "../../domain/weight.ts";
import { carrierFor } from "./carrier.ts";

/** The shipping cost for a parcel, in cents. */
export function shippingQuote(weightGrams: number): number {
  if (weightGrams > maxParcelGrams()) throw new RangeError("parcel too heavy");
  const band = bandFor(weightGrams);
  return carrierFor(band).baseCents + band.surchargeCents;
}
