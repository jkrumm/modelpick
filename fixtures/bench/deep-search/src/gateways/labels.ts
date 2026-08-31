import { defaultMode } from "../config/payment.ts";
import { gatewayFor } from "./registry.ts";

/** The display name of the gateway the default mode maps to. */
export function gatewayLabel(): string {
  return gatewayFor(defaultMode()).label;
}

/** A short slug for the gateway, safe to put in a URL. */
export function gatewaySlug(): string {
  return gatewayLabel().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}
