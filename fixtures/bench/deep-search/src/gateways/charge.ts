import type { Gateway } from "./types.ts";

/** A charge request as a gateway wants it. */
export interface ChargeRequest {
  amountCents: number;
  currency: string;
  reference: string;
}

/** Builds the request body for a gateway. */
export function chargeBody(gateway: Gateway, request: ChargeRequest): string {
  return JSON.stringify({ gateway: gateway.id, ...request });
}
