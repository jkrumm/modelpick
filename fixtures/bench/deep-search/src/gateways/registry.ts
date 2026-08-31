import type { PaymentMode } from "../config/payment.ts";
import type { Gateway } from "./types.ts";

const GATEWAYS: Record<PaymentMode, Gateway> = {
  live: { id: "acquirer-eu", label: "Acquirer EU", retries: 3, settles: true },
  sandbox: { id: "acquirer-sbx", label: "Acquirer Sandbox", retries: 2, settles: false },
  test: { id: "stub", label: "Stub", retries: 0, settles: false },
};

/** The gateway adapter registered for `mode`. */
export function gatewayFor(mode: PaymentMode): Gateway {
  return GATEWAYS[mode];
}

/** Every registered gateway, in configuration order. */
export function allGateways(): Gateway[] {
  return Object.values(GATEWAYS);
}
