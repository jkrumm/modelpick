import { createServerFn } from "@tanstack/react-start";
import { loadDecisionSummary, type DecisionSummary } from "~/server/bench/decision-summary";

export type { DecisionSummary };

/**
 * The whole `/decision` page in one read. Thin on purpose: ranking, the pick and
 * its consumers are derived in `~/server/bench/decision-summary`, which ranks
 * with the same function the bench report uses.
 */
export const getDecisionSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<DecisionSummary> => loadDecisionSummary(),
);
