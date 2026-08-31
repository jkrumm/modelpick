import { backoffPlan } from "../util/retry-plan.ts";
import type { Gateway } from "./types.ts";

/** The back-off delays a gateway's retry budget allows. */
export function retryDelays(gateway: Gateway): number[] {
  return backoffPlan(gateway.retries);
}
