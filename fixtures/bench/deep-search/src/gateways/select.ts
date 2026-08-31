import { currentMode } from "../config/payment.ts";
import type { PaymentMode } from "../config/payment.ts";
import { gatewayFor } from "./registry.ts";
import type { Gateway } from "./types.ts";

/** The gateway this process should route a charge through. */
export function selectGateway(): Gateway {
  return gatewayFor(currentMode());
}

/** The gateway a caller-supplied mode maps to, ignoring process configuration. */
export function gatewayForMode(mode: PaymentMode): Gateway {
  return gatewayFor(mode);
}
