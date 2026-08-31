import { isSettling } from "../../config/payment.ts";
import type { PaymentMode } from "../../config/payment.ts";

/** Settles a charge, or reports why it was skipped. */
export function settleCharge(amountCents: number, mode: PaymentMode): string {
  if (!isSettling(mode)) return `skipped ${amountCents}`;
  return `settled ${amountCents}`;
}
