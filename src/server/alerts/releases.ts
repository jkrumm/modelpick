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
export interface RecordRow {
  lineage: string;
  kind: AlertKind | "seed" | "skip";
}
export interface PlannedAlert {
  lineage: string;
  kind: AlertKind;
  push: Push;
}
export interface AlertPlan {
  alerts: PlannedAlert[];
  /** Rows to record regardless of publishing (seed baseline, judged-not-big lineages). */
  silent: RecordRow[];
}

export interface PlanInput {
  variants: readonly AaVariant[];
  models: readonly Model[];
  /** model_id -> accessible per latest probe. */
  probes: ReadonlyMap<string, boolean>;
  /** Lineages / ids already in `release_alert`. */
  alerted: ReadonlySet<string>;
  /** Ids the catalog sync added this run. */
  added: readonly string[];
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
 * Decides which lineages / catalog ids deserve a push. Pure: reads nothing, writes nothing.
 * An empty `alerted` set is the first-ever run: everything currently known is recorded silently.
 */
export function planReleaseAlerts(input: PlanInput): AlertPlan {
  const { variants, models, probes, alerted, added } = input;
  const llm = models.filter((m) => m.modality === "llm");
  const scoredByLineage = new Map<string, AaVariant[]>();
  for (const v of variants) {
    if (v.intelligence === null) continue;
    scoredByLineage.set(v.lineage, [...(scoredByLineage.get(v.lineage) ?? []), v]);
  }

  if (alerted.size === 0) {
    return {
      alerts: [],
      silent: [
        ...[...scoredByLineage.keys()].map((lineage) => ({ lineage, kind: "seed" as const })),
        ...added.map((lineage) => ({ lineage, kind: "seed" as const })),
      ],
    };
  }

  const resolveIu = createLineageResolver(llm.map((m) => m.id));
  const frontier = paretoSlugs(variants);
  const plan: AlertPlan = { alerts: [], silent: [] };
  const alertedCanons = new Set<string>();

  for (const [lineage, rows] of scoredByLineage) {
    if (alerted.has(lineage)) continue;
    const best = Math.max(...rows.map((r) => r.intelligence!));
    const big = (BIG_LABS.has(rows[0]!.creator) && best >= BIG_INTELLIGENCE) || rows.some((r) => frontier.has(r.slug));
    if (!big) {
      plan.silent.push({ lineage, kind: "skip" });
      continue;
    }
    const iuId = resolveIu(lineage);
    if (iuId) alertedCanons.add(canon(iuId));
    plan.alerts.push({
      lineage,
      kind: "aa",
      push: describeLineage({ rows, iuId, callable: iuId !== null && probes.get(iuId) === true }),
    });
  }

  // New IU ids: a lab we follow, not a residency twin of an id already known, not already
  // covered by an AA push for the same model (one push per lineage).
  const addedSet = new Set(added);
  const knownCanons = new Set(models.filter((m) => !addedSet.has(m.id)).map((m) => canon(m.id)));
  for (const id of [...added].toSorted((a, b) => a.length - b.length || a.localeCompare(b))) {
    if (alerted.has(id)) continue;
    const model = llm.find((m) => m.id === id);
    const lab = labOfId(id);
    if (!model || lab === null) {
      plan.silent.push({ lineage: id, kind: "skip" });
      continue;
    }
    const c = canon(id);
    if (knownCanons.has(c) || alertedCanons.has(c)) {
      plan.silent.push({ lineage: id, kind: "skip" });
      continue;
    }
    alertedCanons.add(c);
    plan.alerts.push({
      lineage: id,
      kind: "iu",
      push: {
        title: `New on IU: ${id}`,
        message: `${lab} - no AA score yet\nIU callable: ${probes.get(id) === true ? "yes" : "no"}`,
        priority: "default",
        tags: ["package"],
      },
    });
  }
  return plan;
}

export interface ReleaseAlertDeps {
  load(): Promise<Omit<PlanInput, "added">>;
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
export async function runReleaseAlerts(input: {
  added: readonly string[];
  deps: ReleaseAlertDeps;
}): Promise<ReleaseAlertSummary> {
  const { deps } = input;
  const loaded = await deps.load();
  const plan = planReleaseAlerts({ ...loaded, added: input.added });
  const seeded = loaded.alerted.size === 0;

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
  await deps.record([...plan.silent, ...sent]);
  return { seeded, published: sent.length, failed };
}
