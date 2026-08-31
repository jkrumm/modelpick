import {
  catalogPage,
  refundWindow,
  resolvePolicy,
  shippingQuote,
} from "../services/index.ts";
import { gatewayLabel as labelFor } from "../gateways/labels.ts";
import { healthReport as report } from "../telemetry/health.ts";
import type { CheckoutPolicy } from "../domain/policy.ts";
import type { Health } from "../telemetry/health.ts";
import type { Page } from "../util/paginate.ts";
import { serialize } from "./serialize.ts";
import { requirePositive } from "./validate.ts";

/** GET /checkout/policy — the policy the process will apply to a checkout. */
export function checkoutPolicy(): CheckoutPolicy {
  return resolvePolicy();
}

/** GET /refunds/window — how many days a refund stays open. */
export function refundPolicy(): number {
  return refundWindow();
}

/** GET /gateways/label — the display name of the default gateway. */
export function gatewayLabel(): string {
  return labelFor();
}

/** GET /shipping/quote — the shipping cost for a parcel, in cents. */
export function shippingCost(weightGrams: number): number {
  requirePositive(weightGrams, "weightGrams");
  return shippingQuote(weightGrams);
}

/** GET /catalog — one page of the catalogue, serialised. */
export function catalog(page: number, size: number): string {
  const result: Page<string> = catalogPage(page, size);
  return serialize(result);
}

/** GET /health — the process health report. */
export function health(): Health {
  return report();
}
