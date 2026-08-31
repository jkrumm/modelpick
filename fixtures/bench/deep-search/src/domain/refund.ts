/** A refund request. */
export interface Refund {
  orderId: string;
  amountCents: number;
  reason: string;
}

/** True when a refund covers the whole order. */
export function isFullRefund(refund: Refund, orderTotalCents: number): boolean {
  return refund.amountCents >= orderTotalCents;
}
