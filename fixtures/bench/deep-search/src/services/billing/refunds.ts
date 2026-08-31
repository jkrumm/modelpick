import { refundWindowDays } from "../../config/limits.ts";
import type { PaymentMode } from "../../config/payment.ts";

/** How many days a refund request stays open. */
export function refundWindow(): number {
  return refundWindowDays();
}

/** Whether a refund is still allowed `ageDays` after the order. */
export function refundAllowed(ageDays: number): boolean {
  return ageDays <= refundWindow();
}

/** Refunds are never automatic outside the sandbox. */
export function autoRefunds(mode: PaymentMode): boolean {
  return mode === "sandbox";
}
