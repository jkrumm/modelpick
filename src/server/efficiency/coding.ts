import type { Effort, CodingComponent, EfficiencyCoding } from "./types.js";

/**
 * The coding benchmarks of `coding.components`, by their Epoch metric (file stem; epoch.ts).
 * Cost and tokens per task exist for CursorBench only (`EPOCH_EXTRA_FILES` extras); the rest
 * report null. Keep the metric names in step with epoch.ts (a test cross-checks them).
 */
export const CODING_BENCHMARKS: ReadonlyArray<{
  benchmark: string;
  metric: string;
  costMetric?: string;
  tokensMetric?: string;
}> = [
  {
    benchmark: "cursorbench",
    metric: "cursorbench_external",
    costMetric: "cursorbench_external_cost_per_task",
    tokensMetric: "cursorbench_external_tokens_per_task",
  },
  { benchmark: "swe_bench_verified", metric: "swe_bench_verified" },
  { benchmark: "terminalbench", metric: "terminalbench_external" },
  { benchmark: "frontierswe", metric: "frontierswe_external" },
  { benchmark: "frontiercode", metric: "frontiercode_external" },
  { benchmark: "scicode", metric: "scicode_external" },
  { benchmark: "aider_polyglot", metric: "aider_polyglot_external" },
  { benchmark: "webdev_arena", metric: "webdev_arena_external" },
];

/** A stored Epoch metric row (`metric_snapshot`, source `epoch`). */
export interface EpochRow {
  id: number;
  model_id: string;
  metric: string;
  conditions: string | null;
  value: number;
  captured_at: string;
}

/** The newest row per (model, metric, conditions): metric_snapshot is an append-only history. */
export function latestEpochRows(rows: readonly EpochRow[]): EpochRow[] {
  const newest = new Map<string, EpochRow>();
  for (const row of rows) {
    const key = [row.model_id, row.metric, row.conditions ?? ""].join("\u0000");
    const seen = newest.get(key);
    if (!seen || row.captured_at > seen.captured_at || (row.captured_at === seen.captured_at && row.id > seen.id)) {
      newest.set(key, row);
    }
  }
  return [...newest.values()];
}

interface MetricValues {
  byEffort: Map<string, number>;
  unconditioned: number | null;
}

/** model_id -> metric -> values by effort. */
export type EpochLookup = Map<string, Map<string, MetricValues>>;

export function indexEpochRows(rows: readonly EpochRow[]): EpochLookup {
  const lookup: EpochLookup = new Map();
  for (const row of latestEpochRows(rows)) {
    const byMetric = lookup.get(row.model_id) ?? new Map<string, MetricValues>();
    lookup.set(row.model_id, byMetric);
    const values = byMetric.get(row.metric) ?? { byEffort: new Map(), unconditioned: null };
    byMetric.set(row.metric, values);
    if (row.conditions === null) values.unconditioned = row.value;
    else values.byEffort.set(row.conditions, row.value);
  }
  return lookup;
}

/** AA effort -> the `conditions` value Epoch rows carry; null for `default` (no effort control). */
function conditionOf(effort: Effort): string | null {
  if (effort === "default") return null;
  return effort === "none" ? "off" : effort;
}

/**
 * The Epoch value for one AA variant. An Epoch tier `<base>_<e>` is AA's `<base>-<e>`, and
 * `max` is the bare slug (AA's bare Claude slugs are Max rows), so the match is (model, effort).
 * The unconditioned row is the model's top tier, not a named effort: it answers only a variant
 * with no effort of its own (`default`, or a bare slug whose effort AA names differently) and
 * only when Epoch has no per-effort row of that metric, so a tier never borrows another's value.
 */
function valueFor(values: MetricValues | undefined, input: { effort: Effort; bare: boolean }): number | null {
  if (!values) return null;
  const condition = conditionOf(input.effort);
  const tiered = condition === null ? undefined : values.byEffort.get(condition);
  if (tiered !== undefined) return tiered;
  const mayUseHeadline = input.effort === "default" || input.bare;
  return mayUseHeadline && values.byEffort.size === 0 ? values.unconditioned : null;
}

/** One variant's coding components, in `CODING_BENCHMARKS` order. */
export function codingComponents(input: {
  lookup: EpochLookup;
  modelId: string | null;
  effort: Effort;
  bare: boolean;
}): CodingComponent[] {
  const byMetric = input.modelId ? input.lookup.get(input.modelId) : undefined;
  if (!byMetric) return [];
  const components: CodingComponent[] = [];
  for (const b of CODING_BENCHMARKS) {
    const score = valueFor(byMetric.get(b.metric), input);
    if (score === null) continue;
    components.push({
      benchmark: b.benchmark,
      score,
      costPerTask: b.costMetric ? valueFor(byMetric.get(b.costMetric), input) : null,
      tokensPerTask: b.tokensMetric ? valueFor(byMetric.get(b.tokensMetric), input) : null,
    });
  }
  return components;
}

/** Fewest benchmarks a variant needs for a `coding.score`: one benchmark is a ranking, not a blend. */
export const MIN_CODING_BENCHMARKS = 2;

/**
 * Mid-rank percentile (0-100) of each value among its peers: (below + 0.5 * equal) / n * 100,
 * ties counted including the value itself. A lone value has no peers and gets null.
 */
export function percentileRanks(values: readonly number[]): Array<number | null> {
  if (values.length < 2) return values.map(() => null);
  return values.map((v) => {
    const below = values.filter((x) => x < v).length;
    const equal = values.filter((x) => x === v).length;
    return ((below + equal / 2) / values.length) * 100;
  });
}

/**
 * `coding` for every variant, aligned with `components`. The score is the mean over the
 * variant's benchmarks of its percentile rank among all variants that have that benchmark (a
 * benchmark only one variant has contributes nothing), and only when at least
 * `MIN_CODING_BENCHMARKS` contribute. A variant with no components has no `coding` object.
 */
export function buildCoding(componentsByVariant: ReadonlyArray<readonly CodingComponent[]>): Array<EfficiencyCoding | null> {
  const percentiles = componentsByVariant.map(() => [] as number[]);
  for (const { benchmark } of CODING_BENCHMARKS) {
    const holders = componentsByVariant.flatMap((components, variant) => {
      const hit = components.find((c) => c.benchmark === benchmark);
      return hit ? [{ variant, score: hit.score }] : [];
    });
    const ranks = percentileRanks(holders.map((h) => h.score));
    holders.forEach((h, i) => {
      const rank = ranks[i];
      if (rank !== null && rank !== undefined) percentiles[h.variant]!.push(rank);
    });
  }
  return componentsByVariant.map((components, variant) => {
    if (components.length === 0) return null;
    const ranks = percentiles[variant]!;
    const score = ranks.length >= MIN_CODING_BENCHMARKS ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
    return { score, components: [...components] };
  });
}
