/**
 * Pre-v3 payment configuration. Nothing in `src/api/` reaches this any more —
 * it stays until the last v2 worker is retired.
 */

/** The v2 payment mode string, read straight from the environment. */
export function legacyPaymentMode(): string {
  return process.env.PAYMENT_MODE ?? "off";
}

/** True when the v2 worker would have settled real money. */
export function legacyIsLive(): boolean {
  return legacyPaymentMode() === "live";
}
