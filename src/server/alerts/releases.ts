import { canon } from "../collectors/normalize.js";
import { createLineageResolver } from "../efficiency/build.js";
import type { AaVariant, Model } from "../../db/schema.js";
import type { Push, PublishOutcome } from "./ntfy.js";

// Labs whose releases are worth a push (AA `model_creator.name`).
const BIG_LABS = new Set([
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepSeek",
  "SpaceXAI",
  "Meta",
  "Alibaba",
  "Kimi",
  "Z AI",
  "Mistral",
]);
const BIG_INTELLIGENCE = 30;

/** Lab of a catalog id by name. Ids no pattern names return null and never alert. */
const ID_LABS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(gpt|o\d|chatgpt|codex)/i, "OpenAI"],
  [/^claude/i, "Anthropic"],
  [/^(gemini|gemma)/i, "Google"],
  [/^deepseek/i, "DeepSeek"],
  [/^grok/i, "SpaceXAI"],
  [/^llama/i, "Meta"],
  [/^qwen/i, "Alibaba"],
  [/^kimi/i, "Kimi"],
  [/^glm/i, "Z AI"],
  [/^(mistral|magistral|devstral|codestral|ministral)/i, "Mistral"],
];

export function labOfId(id: string): string | null {
  const bare = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  return ID_LABS.find(([re]) => re.test(bare))?.[1] ?? null;
}

export type AlertKind = "aa" | "iu";
/** `seed` = AA baseline, `iu_seed` = IU baseline; neither ever alerts. */
export type RecordKind = AlertKind | "seed" | "iu_seed";
export interface RecordRow {
  lineage: string;
  kind: RecordKind;
}
export interface PlannedAlert {
  lineage: string;
  kind: AlertKind;
  push: Push;
}
export interface AlertPlan {
  alerts: PlannedAlert[];
  /** Baseline rows to record regardless of publishing. */
  seeds: RecordRow[];
}

export interface PlanInput {
  variants: readonly AaVariant[];
  models: readonly Model[];
  /** model_id -> accessible per latest probe. */
  probes: ReadonlyMap<string, boolean>;
  /** Everything in `release_alert`: lineage / IU id -> kind. */
  alerted: ReadonlyMap<string, RecordKind>;
}

/** Non-dominated points of (costPerTask low, intelligence high). */
function paretoSlugs(variants: readonly AaVariant[]): Set<string> {
  const pts = variants.filter((v) => v.intelligence !== null && v.cost_per_task !== null);
  const front = pts.filter(
    (p) =>
      !pts.some(
        (q) =>
          q !== p &&
          q.cost_per_task! <= p.cost_per_task! &&
          q.intelligence! >= p.intelligence! &&
          (q.cost_per_task! < p.cost_per_task! || q.intelligence! > p.intelligence!),
      ),
  );
  return new Set(front.map((p) => p.slug));
}

const usd = (n: number): string => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

function describeLineage(input: {
  rows: readonly AaVariant[];
  iuId: string | null;
  callable: boolean;
}): Push {
  const { rows, iuId, callable } = input;
  const best = rows.reduce((a, b) => (b.intelligence! > a.intelligence! ? b : a));
  const name = best.name.replace(/\s*\([^)]*\)$/, "");
  const costs = rows.flatMap((r) => (r.cost_per_task === null ? [] : [r.cost_per_task]));
  const cost =
    costs.length === 0
      ? "n/a"
      : Math.min(...costs) === Math.max(...costs)
        ? usd(costs[0]!)
        : `${usd(Math.min(...costs))} - ${usd(Math.max(...costs))}`;
  const tokens =
    best.cost_per_task !== null && best.price_out
      ? `~${Math.round(best.cost_per_task / best.price_out * 1000)}k tokens/task (est.)`
      : "tokens n/a";
  return {
    title: `New model: ${name}`,
    message: [
      `${best.creator} - intelligence ${best.intelligence} (best effort: ${best.name})`,
      `$/task ${cost}, ${tokens}`,
      `IU callable: ${callable ? `yes (${iuId})` : "no"}`,
      "Source: Artificial Analysis (artificialanalysis.ai)",
    ].join("\n"),
    priority: "default",
    tags: ["sparkles"],
  };
}

/**
 * Decides which lineages / IU ids deserve a push. Pure: reads nothing, writes nothing.
 * Both candidate sets come from tables, never from a run-local list, so a push that failed
 * or was skipped is a candidate again on the next run. A candidate judged not big is simply
 * not recorded and is re-evaluated every run until it crosses the bar.
 *
 * Seeding is per kind: with no AA rows (`aa`/`seed`) every scored lineage is recorded
 * silently; with no IU rows (`iu`/`iu_seed`) every listed IU llm id is. That keeps a DB
 * seeded before IU alerts existed from firing for the whole catalog.
 */
export function planReleaseAlerts(input: PlanInput): AlertPlan {
  const { variants, models, probes, alerted } = input;
  const llm = models.filter((m) => m.modality === "llm");
  const listed = llm.filter((m) => m.iu_listed);
  const scoredByLineage = new Map<string, AaVariant[]>();
  for (const v of variants) {
    if (v.intelligence === null) continue;
    scoredByLineage.set(v.lineage, [...(scoredByLineage.get(v.lineage) ?? []), v]);
  }

  const kinds = new Set(alerted.values());
  const seedAa = !kinds.has("aa") && !kinds.has("seed");
  const seedIu = !kinds.has("iu") && !kinds.has("iu_seed");
  const plan: AlertPlan = { alerts: [], seeds: [] };
  if (seedAa) {
    for (const lineage of scoredByLineage.keys()) plan.seeds.push({ lineage, kind: "seed" });
  }
  if (seedIu) {
    for (const m of listed) plan.seeds.push({ lineage: m.id, kind: "iu_seed" });
  }

  const resolveIu = createLineageResolver(llm.map((m) => m.id));
  const frontier = paretoSlugs(variants);
  // Canonical forms already covered: recorded ids and ids pushed in this plan (one push per lineage).
  const coveredCanons = new Set([...alerted.keys()].map(canon));

  if (!seedAa) {
    for (const [lineage, rows] of scoredByLineage) {
      if (alerted.has(lineage)) continue;
      const best = Math.max(...rows.map((r) => r.intelligence!));
      const big =
        (BIG_LABS.has(rows[0]!.creator) && best >= BIG_INTELLIGENCE) ||
        rows.some((r) => frontier.has(r.slug));
      if (!big) continue;
      const iuId = resolveIu(lineage);
      if (iuId) coveredCanons.add(canon(iuId));
      plan.alerts.push({
        lineage,
        kind: "aa",
        push: describeLineage({ rows, iuId, callable: iuId !== null && probes.get(iuId) === true }),
      });
    }
  }

  if (!seedIu) {
    // Shortest id first so a residency twin (`-eu`) is covered by its base id.
    for (const m of [...listed].toSorted((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))) {
      const lab = labOfId(m.id);
      if (lab === null || alerted.has(m.id) || coveredCanons.has(canon(m.id))) continue;
      coveredCanons.add(canon(m.id));
      plan.alerts.push({
        lineage: m.id,
        kind: "iu",
        push: {
          title: `New on IU: ${m.id}`,
          message: `${lab} - no AA score yet\nIU callable: ${probes.get(m.id) === true ? "yes" : "no"}`,
          priority: "default",
          tags: ["package"],
        },
      });
    }
  }
  return plan;
}

export interface ReleaseAlertDeps {
  load(): Promise<PlanInput>;
  record(rows: RecordRow[]): Promise<void>;
  publish(push: Push): Promise<PublishOutcome>;
}

export interface ReleaseAlertSummary {
  seeded: boolean;
  published: number;
  /** Publishes that threw; each retries on the next run because it was not recorded. */
  failed: number;
}

/**
 * Plans, publishes, and records. A lineage is recorded only after its publish succeeded, so a
 * failure (or a missing NTFY_URL, or a dry run) retries on the next run. Never throws on a
 * publish failure: it is counted for the caller to degrade the run.
 */
export async function runReleaseAlerts(input: { deps: ReleaseAlertDeps }): Promise<ReleaseAlertSummary> {
  const { deps } = input;
  const plan = planReleaseAlerts(await deps.load());
  const seeded = plan.seeds.length > 0;

  const sent: RecordRow[] = [];
  let failed = 0;
  for (const alert of plan.alerts) {
    try {
      if ((await deps.publish(alert.push)) === "sent") sent.push({ lineage: alert.lineage, kind: alert.kind });
    } catch (err) {
      failed++;
      console.error(`[alerts] publish failed for ${alert.lineage}: ${String(err)}`);
    }
  }
  await deps.record([...plan.seeds, ...sent]);
  return { seeded, published: sent.length, failed };
}
