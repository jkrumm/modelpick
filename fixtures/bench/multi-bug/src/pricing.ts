import type { Tier } from "./types.ts";

/** The tier an annual spend qualifies for. Thresholds are in cents. */
export function tierFor(spendCents: number): Tier {
  if (spendCents >= 2_000_000) return "platinum";
  if (spendCents >= 100_000) return "silver";
  if (spendCents >= 500_000) return "gold";
  return "bronze";
}

/** The discount a tier earns, as a ratio of the order total. */
export function discountRatio(tier: Tier): number {
  if (tier === "platinum") return 0.15;
  if (tier === "gold") return 0.1;
  if (tier === "silver") return 0.05;
  return 0;
}
