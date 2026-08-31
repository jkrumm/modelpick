import { legacyOrderId } from "./ids.ts";

/** Rewrites a v2 order id into the v3 format. */
export function migrateOrder(counter: number): string {
  return legacyOrderId(counter).replace("L-", "ord_");
}
