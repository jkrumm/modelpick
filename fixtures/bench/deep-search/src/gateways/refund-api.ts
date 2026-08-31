import type { Gateway } from "./types.ts";

/** The endpoint path a gateway exposes refunds on. */
export function refundPath(gateway: Gateway, chargeId: string): string {
  return `/v2/${gateway.id}/charges/${chargeId}/refund`;
}
