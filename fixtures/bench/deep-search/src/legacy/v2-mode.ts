import { legacyPaymentMode } from "./payment-shim.ts";

/** The v2 mode string, normalised to lower case. */
export function normalizedLegacyMode(): string {
  return legacyPaymentMode().toLowerCase();
}
