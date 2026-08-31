import { readPaymentMode as readMode } from "./env-source.ts";

/** The payment modes the gateways understand. */
export type PaymentMode = "live" | "test" | "sandbox";

/** The mode used when nothing has been configured. */
export function defaultMode(): PaymentMode {
  return "test";
}

/** The mode this process is running in. */
export function currentMode(): PaymentMode {
  const raw = readMode();
  if (raw === "live" || raw === "sandbox") return raw;
  return defaultMode();
}

/** True when the mode is one the gateways will settle real money in. */
export function isSettling(mode: PaymentMode): boolean {
  return mode === "live";
}
