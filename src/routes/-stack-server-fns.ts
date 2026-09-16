import { createServerFn } from "@tanstack/react-start";
import {
  getDeployments,
  getLatestProbes,
  getLatestRecommendations,
  getModels,
  getStackChoices,
} from "~/db/queries";
import { SERVICE } from "~/db/schema";
import type {
  Recommendation,
  RecommendationCategory,
  Service,
  StackCategory,
  Thinking,
} from "~/db/schema";
import { loadBenchSummary, type BenchPicks } from "~/server/bench/summary";

// A deployment row is stale once its config claim hasn't been re-checked in a
// month — long enough that another change in that file is plausible.
export const STALE_AFTER_DAYS = 30;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24));
}

// Display order for the stack table — scored categories first (mirrors the
// Decider), then the manual categories that have no algorithmic recommendation.
const CATEGORY_ORDER: StackCategory[] = [
  "fast",
  "coding",
  "writing",
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
  /** How many `deployment` rows actually call this model — 0 means the pick
   *  is an idea nothing runs. */
  slotCount: number;
}

export type DeploymentFlag =
  | "unresolvable" // model_id has no row in `models` — the id does not exist on the endpoint
  | "inaccessible" // latest capability_probe for the model says not accessible
  | "drift" // category !== null and the latest recommendation for that category names a different model
  | "stale"; // verified_at is null, or older than STALE_AFTER_DAYS

export interface DeploymentEntry {
  service: Service;
  slot: string;
  label: string;
  model_id: string;
  display_name: string; // from `models`, falling back to model_id
  provider: string | null; // null when the model has no catalog row
  category: RecommendationCategory | null;
  /** False when the category is shown for grouping but is deliberately not followed. */
  follows_recommendation: boolean;
  thinking: Thinking;
  params: string | null;
  config_ref: string;
  rationale: string | null;
  decision_doc: string | null;
  decided_at: string;
  verified_at: string | null;
  /** The algorithm's current top model for this slot's category, when it has one. */
  algo_model_id: string | null;
  algo_display_name: string | null;
  flags: DeploymentFlag[];
}

export interface MyStackData {
  entries: StackEntry[];
  snapshotDate: string | null;
  deployments: DeploymentEntry[];
}

export interface DeriveFlagsInput {
  hasModel: boolean;
  /** Null when the model was never probed — distinct from a probe that says inaccessible. */
  probeAccessible: boolean | null;
  category: RecommendationCategory | null;
  /**
   * False when the slot uses its category for grouping but deliberately does
   * not follow that category's recommendation. Without it `drift` fires on
   * every Max-plan and residency-gated slot at once — 28 of 54 — which reads
   * as noise and trains you to ignore the flag that matters.
   */
  followsRecommendation: boolean;
  modelId: string;
  algoModelId: string | null;
  verifiedAt: string | null;
  today: string; // yyyy-mm-dd
}

/** Pure so the flag rules are testable without a database. */
export function deriveFlags(input: DeriveFlagsInput): DeploymentFlag[] {
  const flags: DeploymentFlag[] = [];

  if (!input.hasModel) {
    flags.push("unresolvable");
  } else if (input.probeAccessible === false) {
    flags.push("inaccessible");
  }

  if (
    input.category !== null &&
    input.followsRecommendation &&
    input.algoModelId !== null &&
    input.algoModelId !== input.modelId
  ) {
    flags.push("drift");
  }

  if (input.verifiedAt === null || daysBetween(input.verifiedAt, input.today) > STALE_AFTER_DAYS) {
    flags.push("stale");
  }

  return flags;
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

// SERVICE tuple order (dotfiles/execution-modes order), not alphabetical —
// `getDeployments()` sorts alphabetically for its own callers, so re-sort here.
const SERVICE_ORDER = new Map(SERVICE.map((service, i) => [service, i]));

export const getMyStack = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyStackData> => {
    const [choices, allModels, recs, bench, allDeployments, probes] = await Promise.all([
      getStackChoices(),
      getModels(),
      getLatestRecommendations(),
      loadBenchSummary({ suiteId: null }),
      getDeployments(),
      getLatestProbes(),
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

    const slotCountByModel = new Map<string, number>();
    for (const d of allDeployments) {
      slotCountByModel.set(d.model_id, (slotCountByModel.get(d.model_id) ?? 0) + 1);
    }

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
        slotCount: slotCountByModel.get(choice.model_id) ?? 0,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const orderedDeployments = allDeployments.toSorted((a, b) => {
      const serviceDiff = (SERVICE_ORDER.get(a.service) ?? 0) - (SERVICE_ORDER.get(b.service) ?? 0);
      return serviceDiff !== 0 ? serviceDiff : a.slot.localeCompare(b.slot);
    });

    const deployments: DeploymentEntry[] = orderedDeployments.map((d) => {
      const model = modelMap.get(d.model_id);
      const probe = probes[d.model_id];
      const rec = d.category !== null ? recByCategory.get(d.category) : undefined;
      const algoModelId = rec?.model_id ?? null;
      const algoDisplayName =
        rec !== undefined ? (modelMap.get(rec.model_id)?.display_name ?? rec.model_id) : null;

      const flags = deriveFlags({
        hasModel: model !== undefined,
        probeAccessible: probe !== undefined ? probe.accessible : null,
        category: d.category,
        followsRecommendation: d.follows_recommendation,
        modelId: d.model_id,
        algoModelId,
        verifiedAt: d.verified_at,
        today,
      });

      return {
        service: d.service,
        slot: d.slot,
        label: d.label,
        model_id: d.model_id,
        display_name: model?.display_name ?? d.model_id,
        provider: model?.provider ?? null,
        category: d.category,
        follows_recommendation: d.follows_recommendation,
        thinking: d.thinking,
        params: d.params,
        config_ref: d.config_ref,
        rationale: d.rationale,
        decision_doc: d.decision_doc,
        decided_at: d.decided_at,
        verified_at: d.verified_at,
        algo_model_id: algoModelId,
        algo_display_name: algoDisplayName,
        flags,
      };
    });

    return { entries, snapshotDate: recs[0]?.snapshot_date ?? null, deployments };
  },
);
