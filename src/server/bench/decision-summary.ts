/**
 * The `/decision` tab's derivation: which decision models exist, how the live
 * bench ranks them, which one is the pick, and who consumes it.
 *
 * `buildDecisionSummary` is pure — rows in, shape out, no DB, no fs, no clock —
 * and ranks with the same `rankDecisionRows` the bench report uses, so the page
 * and `docs/experiments/decision-*` cannot disagree. `loadDecisionSummary` is the
 * thin adapter that reads `modelpick.db`.
 *
 * Only `import type` may reach this file from a client component: the value
 * import chain through `db` drags the libsql client into the browser bundle (see
 * the note at the top of format.ts).
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { decisionSpec } from "../../db/decision-models.js";
import { deployment, metricSnapshot, models, stackChoice } from "../../db/schema.js";
import type { Residency } from "../../db/schema.js";
import { getLatestProbes } from "../../db/queries.js";
import { DECISION_TASKS } from "./decision-tasks.js";
import { rankDecisionRows, rowFromMetrics, type DecisionRow } from "./decision-metrics.js";

export const DECISION_DOC = "docs/decisions/decision-model.md";

export interface DecisionModelInput {
  id: string;
  display_name: string;
  provider: string;
}

export interface DecisionMetricInput {
  model_id: string;
  metric: string;
  value: number;
  captured_at: string;
}

export interface DecisionConsumerInput {
  service: string;
  slot: string;
  label: string;
  model_id: string;
  config_ref: string;
  verified_at: string | null;
}

export interface DecisionPickInput {
  model_id: string;
  rationale: string | null;
  env_note: string | null;
  decided_at: string;
}

export interface DecisionTableRow extends DecisionRow {
  displayName: string;
  provider: string;
  /** "eu" when IU documents EU-only hosting; otherwise the probe's reading. */
  region: "eu" | Residency;
  /** Latest probe verdict; null when never probed. */
  accessible: boolean | null;
  isPick: boolean;
  note: string | null;
  /** Newest `captured_at` among this model's decision metrics. */
  measuredAt: string | null;
}

export interface DecisionSummary {
  doc: string;
  /** Ranked, benched models first-to-last. */
  rows: DecisionTableRow[];
  /** Catalog decision models the bench has never measured. */
  unbenched: DecisionTableRow[];
  pick: (DecisionPickInput & { displayName: string }) | null;
  /** True when the pick is not the bench's top row — an owner decision worth saying out loud. */
  pickIsNotTop: boolean;
  consumers: DecisionConsumerInput[];
  suites: Array<{ id: string; description: string; cases: number }>;
  measuredAt: string | null;
}

export interface DecisionSummaryInput {
  models: DecisionModelInput[];
  metrics: DecisionMetricInput[];
  probes: Record<string, { accessible: boolean; residency: Residency }>;
  pick: DecisionPickInput | null;
  /** Deployment rows already narrowed to the decision category. */
  consumers: DecisionConsumerInput[];
}

function isDecisionMetric(metric: string): boolean {
  return metric.startsWith("decision_");
}

export function buildDecisionSummary(input: DecisionSummaryInput): DecisionSummary {
  // Newest value per (model, metric): rows arrive in any order.
  const latest = new Map<string, Map<string, { value: number; at: string }>>();
  for (const m of input.metrics) {
    if (!isDecisionMetric(m.metric)) continue;
    const byMetric = latest.get(m.model_id) ?? new Map<string, { value: number; at: string }>();
    const seen = byMetric.get(m.metric);
    if (seen === undefined || m.captured_at > seen.at) {
      byMetric.set(m.metric, { value: m.value, at: m.captured_at });
    }
    latest.set(m.model_id, byMetric);
  }

  const toRow = (model: DecisionModelInput): DecisionTableRow => {
    const byMetric = latest.get(model.id);
    const values = new Map([...(byMetric ?? [])].map(([name, v]) => [name, v.value]));
    const probe = input.probes[model.id];
    const spec = decisionSpec(model.id);
    return {
      ...rowFromMetrics(model.id, values),
      displayName: model.display_name,
      provider: model.provider,
      region: spec?.region ?? probe?.residency ?? "unknown",
      accessible: probe?.accessible ?? null,
      isPick: input.pick?.model_id === model.id,
      note: spec?.note ?? null,
      measuredAt:
        byMetric === undefined
          ? null
          : ([...byMetric.values()]
              .map((v) => v.at)
              .toSorted()
              .at(-1) ?? null),
    };
  };

  const all = input.models.map(toRow);
  const rows = rankDecisionRows(all.filter((r) => r.accuracy !== null));
  const unbenched = all.filter((r) => r.accuracy === null);
  const pickModel = input.pick
    ? input.models.find((m) => m.id === input.pick?.model_id)
    : undefined;

  return {
    doc: DECISION_DOC,
    rows,
    unbenched,
    pick:
      input.pick === null
        ? null
        : { ...input.pick, displayName: pickModel?.display_name ?? input.pick.model_id },
    pickIsNotTop: input.pick !== null && rows.length > 0 && rows[0]?.model !== input.pick.model_id,
    consumers: input.consumers,
    suites: DECISION_TASKS.map((t) => ({
      id: t.id,
      description: t.description,
      cases: t.cases.length,
    })),
    measuredAt:
      rows
        .flatMap((r) => (r.measuredAt === null ? [] : [r.measuredAt]))
        .toSorted()
        .at(-1) ?? null,
  };
}

export async function loadDecisionSummary(): Promise<DecisionSummary> {
  const [decisionModels, metricRows, probes, choices, deployments] = await Promise.all([
    db.select().from(models).where(eq(models.modality, "decision")),
    db
      .select({
        model_id: metricSnapshot.model_id,
        metric: metricSnapshot.metric,
        value: metricSnapshot.value,
        captured_at: metricSnapshot.captured_at,
      })
      .from(metricSnapshot)
      .where(eq(metricSnapshot.source, "live"))
      .orderBy(desc(metricSnapshot.captured_at)),
    getLatestProbes(),
    db.select().from(stackChoice).where(eq(stackChoice.category, "decision")),
    db.select().from(deployment).where(eq(deployment.category, "decision")),
  ]);

  const choice = choices[0];
  return buildDecisionSummary({
    models: decisionModels,
    metrics: metricRows,
    probes,
    pick: choice
      ? {
          model_id: choice.model_id,
          rationale: choice.rationale,
          env_note: choice.env_note,
          decided_at: choice.decided_at,
        }
      : null,
    consumers: deployments,
  });
}
