import { padZero } from "../util/pad.ts";

/** A deterministic idempotency key for a charge attempt. */
export function idempotencyKey(orderId: string, attempt: number): string {
  return `${orderId}-${padZero(attempt, 3)}`;
}
