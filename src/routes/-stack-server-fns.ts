import { createServerFn } from "@tanstack/react-start";
import { getModels, getLatestRecommendations, getStackChoices } from "~/db/queries";
import type { RecommendationCategory } from "~/db/schema";

// Display order for the stack table — mirrors the Decider.
const CATEGORY_ORDER: RecommendationCategory[] = ["fast", "coding", "orchestrator", "tts", "stt"];

export interface StackPick {
  model_id: string;
  display_name: string;
  provider: string;
}

export interface StackEntry {
  category: RecommendationCategory;
  pick: StackPick;
  env_note: string | null;
  rationale: string | null;
  decided_at: string;
  /** The algorithm's current top pick for this category, if one is persisted. */
  algo: { model_id: string; display_name: string; score: number } | null;
  /** True when the algorithm's pick differs from mine — i.e. worth a review. */
  drift: boolean;
}

export interface MyStackData {
  entries: StackEntry[];
  snapshotDate: string | null;
}

export const getMyStack = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyStackData> => {
    const [choices, allModels, recs] = await Promise.all([
      getStackChoices(),
      getModels(),
      getLatestRecommendations(),
    ]);

    const modelMap = new Map(allModels.map((m) => [m.id, m]));
    const choiceByCategory = new Map(choices.map((c) => [c.category, c]));
    const recByCategory = new Map(recs.map((r) => [r.category, r]));

    const entries: StackEntry[] = [];
    for (const category of CATEGORY_ORDER) {
      const choice = choiceByCategory.get(category);
      if (choice === undefined) continue;

      const pickModel = modelMap.get(choice.model_id);
      const rec = recByCategory.get(category);
      const recModel = rec !== undefined ? modelMap.get(rec.model_id) : undefined;

      const algo =
        rec !== undefined
          ? {
              model_id: rec.model_id,
              display_name: recModel?.display_name ?? rec.model_id,
              score: rec.score,
            }
          : null;

      entries.push({
        category,
        pick: {
          model_id: choice.model_id,
          display_name: pickModel?.display_name ?? choice.model_id,
          provider: pickModel?.provider ?? "—",
        },
        env_note: choice.env_note,
        rationale: choice.rationale,
        decided_at: choice.decided_at,
        algo,
        drift: algo !== null && algo.model_id !== choice.model_id,
      });
    }

    return { entries, snapshotDate: recs[0]?.snapshot_date ?? null };
  },
);
