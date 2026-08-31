/** How urgently an order should be picked. */
export type Priority = "standard" | "express" | "same-day";

/** The picking priority implied by a shipping choice. */
export function priorityFor(shippingCode: string): Priority {
  if (shippingCode === "SD") return "same-day";
  if (shippingCode === "EX") return "express";
  return "standard";
}
