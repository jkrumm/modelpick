import { selectGateway as pickGateway } from "../../gateways/select.ts";
import { policyFromGateway } from "../../domain/policy.ts";
import type { CheckoutPolicy } from "../../domain/policy.ts";

/** The checkout policy this process should apply. */
export function resolvePolicy(): CheckoutPolicy {
  return policyFromGateway(pickGateway());
}

/** A human-readable one-liner for the resolved policy. */
export function describePolicy(policy: CheckoutPolicy): string {
  return `${policy.name} (retries: ${policy.retries})`;
}
