import { bandFor } from "../../domain/weight.ts";

/** How many parcels `weights` need, packed greedily up to `limitGrams`. */
export function packingPlan(weights: number[], limitGrams: number): number[][] {
  const parcels: number[][] = [];
  let current: number[] = [];
  let load = 0;
  for (const weight of weights) {
    if (load + weight > limitGrams && current.length > 0) {
      parcels.push(current);
      current = [];
      load = 0;
    }
    current.push(weight);
    load += weight;
  }
  if (current.length > 0) parcels.push(current);
  return parcels;
}

/** The band the heaviest parcel in a plan falls into. */
export function heaviestBand(plan: number[][]): string {
  const heaviest = Math.max(0, ...plan.map((parcel) => parcel.reduce((a, b) => a + b, 0)));
  return bandFor(heaviest).name;
}
