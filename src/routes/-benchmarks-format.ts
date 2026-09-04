/**
 * Pure formatting + labeling for the /benchmarks matrix. No DB import — this
 * gets pulled directly into the route component, and src/db/index.ts
 * constructs the libsql client at module scope, so any import chain reaching
 * it lands the node client in the browser bundle and throws
 * `Neon: unsupported system: undefined`. See src/server/bench/format.ts's own
 * header for the fuller story; formatRate/formatDuration/formatPct/MISSING
 * are reused from there rather than reimplemented, since that module already
 * proved safe to import into a route component (src/routes/bench.tsx does it).
 */
import { formatDuration, formatPct, formatRate, MISSING } from "~/server/bench/format";

export { MISSING };

// ── (source, metric) column keys ────────────────────────────────────────────

const KEY_SEP = "::";

/** Stable column id for a (source, metric) pair. Metric names never contain
 *  `::`, so this round-trips cleanly through parseMetricKey. */
export function metricKey(source: string, metric: string): string {
  return `${source}${KEY_SEP}${metric}`;
}

export function parseMetricKey(key: string): { source: string; metric: string } {
  const idx = key.indexOf(KEY_SEP);
  if (idx === -1) return { source: key, metric: key };
  return { source: key.slice(0, idx), metric: key.slice(idx + KEY_SEP.length) };
}

// ── column labels ────────────────────────────────────────────────────────────

// Benchmark names that don't title-case sensibly. Anything not listed here
// falls through to the generic "snake_case -> Title Case" formatter below, so
// a metric a future collector adds still renders as something legible with no
// change to this file.
const METRIC_LABEL_OVERRIDES: Record<string, string> = {
  ttft_ms: "TTFT",
  mmlu_pro: "MMLU-Pro",
  gpqa: "GPQA",
  hle: "HLE",
  lcr: "LCR",
  tau2: "Tau2",
  tau_banking: "Tau Banking",
  aime: "AIME",
  aime_25: "AIME 25",
  ifbench: "IFBench",
  scicode: "SciCode",
  math_500: "MATH-500",
  terminalbench_hard: "TB Hard",
  terminalbench_v2_1: "TB 2.1",
  livecodebench: "LiveCodeBench",
};

export function metricLabel(metric: string): string {
  const override = METRIC_LABEL_OVERRIDES[metric];
  if (override !== undefined) return override;
  // Epoch names most files `<benchmark>_external.csv` to mark an eval it did not
  // author. That distinction belongs in the source column, not repeated on every
  // header — "Arc Agi 2 External" is just noisier than "Arc Agi 2".
  return metric
    .replace(/_external$/, "")
    .split("_")
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

const SOURCE_LABELS: Record<string, string> = {
  artificialanalysis: "ArtificialAnalysis",
  openrouter: "OpenRouter",
  live: "Live probe",
  iu: "IU",
  epoch: "Epoch AI",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// ── value formatting ─────────────────────────────────────────────────────────

function formatCompactNumber(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

function formatUnixSeconds(v: number): string {
  return new Date(v * 1000).toISOString().slice(0, 10);
}

/**
 * One number, formatted per its metric family — deliberately never
 * normalized onto a common scale, since that would hide exactly the
 * "which unit is this" honesty the page exists for. Known families key off
 * the metric name; anything unrecognized falls back to reading the *value's
 * own scale*: a 0-1 number is treated as a fraction (most AA evals report
 * that way), anything else as a raw index/count. That fallback is what lets a
 * metric a future collector adds render sanely with no code change here.
 */
export function formatMetricValue(metric: string, value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  if (metric.includes("price")) return formatRate(value);
  if (metric === "context_window") return formatCompactNumber(value);
  if (metric === "release_date") return formatUnixSeconds(value);
  if (metric === "ttft_ms") return formatDuration(value);
  if (metric === "latency_p50") return `${value.toFixed(2)}s`; // AA reports this in seconds, not ms
  if (metric === "throughput") return `${Math.round(value)} tok/s`;
  if (metric === "tool_call_rounds") return value.toFixed(1);
  if (value >= 0 && value <= 1) return formatPct(value);
  return value.toFixed(1);
}
