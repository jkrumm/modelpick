import type { Gateway } from "../gateways/types.ts";

/** The rules a checkout is processed under. */
export interface CheckoutPolicy {
  name: string;
  retries: number;
  capturesImmediately: boolean;
}

/** The policy a gateway implies. */
export function policyFromGateway(gateway: Gateway): CheckoutPolicy {
  return {
    name: gateway.label,
    retries: gateway.retries,
    capturesImmediately: gateway.settles,
  };
}

/** True when the policy will retry at least once. */
export function retriesAtAll(policy: CheckoutPolicy): boolean {
  return policy.retries > 0;
}
