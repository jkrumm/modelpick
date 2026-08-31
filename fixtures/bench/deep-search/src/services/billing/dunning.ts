import { backoffPlan } from "../../util/retry-plan.ts";

/** The days after which each dunning reminder goes out. */
export function dunningSchedule(reminders: number): number[] {
  return backoffPlan(reminders).map((ms) => Math.round(ms / 100));
}
