import { createServerFn } from "@tanstack/react-start";
import { getModels, getLatestRecommendations, getStackChoices } from "~/db/queries";
import type { Recommendation, StackCategory } from "~/db/schema";
import { loadBenchSummary, type BenchPicks } from "~/server/bench/summary";

// Display order for the stack table — scored categories first (mirrors the
// Decider), then the manual categories that have no algorithmic recommendation.
const CATEGORY_ORDER: StackCategory[] = [
  "fast",
  "coding",
  "orchestrator",
  "tts",
  "stt",
  "embedding",
  "vision",
  "image",
];

export interface StackPick {
  model_id: string;
  display_name: string;
  provider: string;
}

export interface StackEntry {
  category: StackCategory;
  pick: StackPick;
  env_note: string | null;
  rationale: string | null;
  decided_at: string;
  /** The algorithm's current top pick for this category, if one is persisted. */
  algo: { model_id: string; display_name: string; score: number } | null;
  /**
   * ccbench's picks from the newest suite — the coding category only, since
   * that is the one dimension the agentic benchmark measures. Null when no
   * suite has ranked a field yet.
   */
  bench: { suite_id: string; worker: StackPick | null; interactive: StackPick | null } | null;
  /**
   * True when a persisted pick disagrees with mine — the algorithm's, or (for
   * coding) both of ccbench's, since the seed names one model for a category
   * the bench splits into a worker and an interactive role.
   */
  drift: boolean;
}

export interface MyStackData {
  entries: StackEntry[];
  snapshotDate: string | null;
}

function benchPicksFor(
  category: StackCategory,
  picks: BenchPicks,
  suiteId: string,
  toPick: (modelId: string) => StackPick,
): StackEntry["bench"] {
  if (category !== "coding" || suiteId === "") return null;
  if (picks.worker === null && picks.interactive === null) return null;
  return {
    suite_id: suiteId,
    worker: picks.worker !== null ? toPick(picks.worker.modelId) : null,
    interactive: picks.interactive !== null ? toPick(picks.interactive.modelId) : null,
  };
}

function benchAgrees(bench: StackEntry["bench"], modelId: string): boolean {
  if (bench === null) return true;
  return bench.worker?.model_id === modelId || bench.interactive?.model_id === modelId;
}

export const getMyStack = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyStackData> => {
    const [choices, allModels, recs, bench] = await Promise.all([
      getStackChoices(),
      getModels(),
      getLatestRecommendations(),
      loadBenchSummary({ suiteId: null }),
    ]);

    const modelMap = new Map(allModels.map((m) => [m.id, m]));
    const toPick = (modelId: string): StackPick => ({
      model_id: modelId,
      display_name: modelMap.get(modelId)?.display_name ?? modelId,
      provider: modelMap.get(modelId)?.provider ?? "—",
    });
    const choiceByCategory = new Map(choices.map((c) => [c.category, c]));
    // Keyed by string: manual categories (embedding/vision/image) never have a
    // recommendation row, so their lookup is a miss → algo null → no drift flag.
    const recByCategory = new Map<string, Recommendation>(recs.map((r) => [r.category, r]));

    const entries: StackEntry[] = [];
    for (const category of CATEGORY_ORDER) {
      const choice = choiceByCategory.get(category);
      if (choice === undefined) continue;

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

      const benchPicks = benchPicksFor(category, bench.picks, bench.suiteId, toPick);
      const algoDrift = algo !== null && algo.model_id !== choice.model_id;

      entries.push({
        category,
        pick: toPick(choice.model_id),
        env_note: choice.env_note,
        rationale: choice.rationale,
        decided_at: choice.decided_at,
        algo,
        bench: benchPicks,
        drift: algoDrift || !benchAgrees(benchPicks, choice.model_id),
      });
    }

    return { entries, snapshotDate: recs[0]?.snapshot_date ?? null };
  },
);
