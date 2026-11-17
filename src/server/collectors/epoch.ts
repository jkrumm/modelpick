/**
 * Collects benchmark scores from Epoch AI's public benchmark data export.
 *
 * https://epoch.ai/data/benchmark_data.zip — no auth, no key, unlike every
 * other collector in this directory. Epoch runs the evals itself (scores link
 * to Inspect-AI transcripts on S3) rather than reprinting vendor claims, and
 * covers benchmarks artificialanalysis.ts has no column for at all
 * (swe_bench_verified, arc_agi/arc_agi_2, frontiermath, aider_polyglot, ...).
 *
 * Licence: CC-BY 4.0. Attribution to Epoch AI is a licence condition, not a
 * nicety — keep the notice in epoch-benchmarks.ts (the generated snapshot
 * this collector writes) and don't strip it if this data is copied elsewhere.
 *
 * `benchmark_metadata.csv` is the index this whole collector is driven by: it
 * names each benchmark's `source_file` and `score_column`, so nothing here
 * hardcodes a per-file column guess. Benchmarks with a blank `source_file`
 * (in_eci=False, e.g. LiveBench, BoolQ) are in the index but ship no per-model
 * CSV — captured in the snapshot with `metric: null`, no rows ingested. Files
 * the index does not list but the zip ships (CursorBench, SciCode, WebDev Arena,
 * SWE-Bench verified) are read through the explicit `EPOCH_EXTRA_FILES` registry.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Thinking } from "../../db/schema.js";
import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";
import type { EpochBenchmark } from "./epoch-benchmarks.js";

const execFileAsync = promisify(execFile);

const EPOCH_ZIP_URL = "https://epoch.ai/data/benchmark_data.zip";

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Epoch's CSVs carry quoted fields with embedded commas, escaped quotes ("")
// and literal embedded newlines (e.g. free-text "Training compute notes"
// columns) — a naive split(",") or line-by-line split silently corrupts rows
// that contain any of these. This is a plain RFC4180 state machine: no
// dependency justified for something this small and this load-bearing to get
// exactly right (a mis-split row could shift every later column silently).

/** Parses CSV text into rows of raw string fields, honouring RFC4180 quoting
 *  (quoted commas, doubled-quote escapes, quoted embedded newlines). */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const c = content[i] ?? "";
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\r") {
      i += 1; // normalize CRLF — the following \n closes the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Parses CSV text into header-keyed records, using the first row as the header. */
export function parseCsvRecords(content: string): Record<string, string>[] {
  const rows = parseCsv(content);
  const header = rows[0];
  if (!header) return [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] ?? "";
    });
    return record;
  });
}

// ── Reasoning-effort suffix ──────────────────────────────────────────────────
// Epoch appends a reasoning-effort suffix (_none/_unknown/_low/_medium/_high/
// _xhigh/_max) to `Model version` for every model it re-ran across multiple
// effort settings — confirmed claude-fable-5-1 alone carries all seven. That
// gives the same model several rows in one benchmark file under what should
// be a single metric name. Averaging across tiers would blur a genuinely
// bimodal metric (a reasoning model at "low" can score half of "high"), and
// letting every tier write to the same metric name would leave whichever row
// inserts last silently overwriting the rest.
//
// Decision: two kinds of row per (model, benchmark). The unconditioned row
// (metric_snapshot.conditions NULL) is the *highest* available effort tier —
// what a model's headline leaderboard number means once effort tiers exist at
// all — and is what every pre-existing consumer reads. Next to it, every tier
// Epoch measured is kept as its own row with the effort in `conditions`
// (low/medium/high/xhigh/max, none -> off), so cost-vs-quality at a given
// effort is answerable (efficiency feed, docs/pipelines.md). "none"/"unknown"
// (and a bare Model version with no matching suffix at all — e.g. a model with
// no reasoning dimension) rank equally at the bottom: none of them claims an
// elevated effort setting, so all defer to any explicit low/medium/high/xhigh/
// max row for the unconditioned slot, and any one of them survives on its own
// if that's genuinely the only measurement available. A bare id and an
// "unknown" tier carry no conditions row: they state no effort. Ties keep
// whichever was seen first in the file, for determinism.
//
// The suffix is matched on a literal underscore only — "qwen3.7-max" (hyphen)
// is a real model name Epoch's own data uses side by side with underscore
// effort suffixes like "glm-5.2_max", and stripping on hyphen would wrongly
// truncate it.
const EFFORT_RANK: Record<string, number> = {
  max: 6,
  xhigh: 5,
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
  none: 1,
};
const NO_SUFFIX_RANK = 1;
const EFFORT_SUFFIX_RE = /_(max|xhigh|high|medium|low|unknown|none)$/i;

/** Epoch effort word -> the `conditions` value it is stored under; null states no effort. */
const EFFORT_CONDITIONS: Readonly<Record<string, Thinking | null>> = {
  max: "max",
  xhigh: "xhigh",
  high: "high",
  medium: "medium",
  low: "low",
  none: "off",
  unknown: null,
};

/**
 * Epoch's free-text reasoning-level label ("Extra High", "XHigh", "extra-high", "Max") as a
 * `conditions` value. Null for an unknown or absent label (and for "unknown" itself).
 */
export function normalizeEffortLabel(label: string): Thinking | null {
  const key = label.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "extrahigh") return EFFORT_CONDITIONS["xhigh"] ?? null;
  if (key === "off" || key === "noreasoning" || key === "nonreasoning") return "off";
  return EFFORT_CONDITIONS[key] ?? null;
}

function rankOfEffort(effort: Thinking | null): number {
  return effort === null ? NO_SUFFIX_RANK : (EFFORT_RANK[effort === "off" ? "none" : effort] ?? NO_SUFFIX_RANK);
}

export interface EffortStrip {
  baseId: string;
  rank: number;
  /** The `conditions` value of the suffix; null for a bare id and for "_unknown". */
  effort: Thinking | null;
}

export function stripEffortSuffix(modelVersion: string): EffortStrip {
  const match = EFFORT_SUFFIX_RE.exec(modelVersion);
  if (!match) return { baseId: modelVersion, rank: NO_SUFFIX_RANK, effort: null };
  const tier = (match[1] ?? "").toLowerCase();
  return {
    baseId: modelVersion.slice(0, match.index),
    rank: EFFORT_RANK[tier] ?? NO_SUFFIX_RANK,
    effort: EFFORT_CONDITIONS[tier] ?? null,
  };
}

// ── benchmark_metadata.csv ───────────────────────────────────────────────────

export interface BenchmarkIndexRow {
  benchmark: string;
  in_eci: boolean;
  source_file: string | null;
  score_column: string | null;
  scale: number;
  random_baseline: number | null;
  score_ceiling: number | null;
  release_date: string | null;
  superseded_by: string | null;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFloatOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parseBenchmarkIndex(csv: string): BenchmarkIndexRow[] {
  return parseCsvRecords(csv).map((row) => ({
    benchmark: row["benchmark"] ?? "",
    in_eci: (row["in_eci"] ?? "").trim().toLowerCase() === "true",
    source_file: blankToNull(row["source_file"] ?? ""),
    score_column: blankToNull(row["score_column"] ?? ""),
    scale: parseFloatOrNull(row["scale"] ?? "") ?? 1,
    random_baseline: parseFloatOrNull(row["random_baseline"] ?? ""),
    score_ceiling: parseFloatOrNull(row["score_ceiling"] ?? ""),
    release_date: blankToNull(row["release_date"] ?? ""),
    superseded_by: blankToNull(row["superseded_by"] ?? ""),
  }));
}

function metricNameOf(sourceFile: string): string {
  return sourceFile.replace(/\.csv$/i, "");
}

// ── Generated snapshot (src/server/collectors/epoch-benchmarks.ts) ──────────
// Regenerated wholesale on every collection run — same shape as
// src/db/iu-catalog.ts's relationship to sync-catalog.ts. The helper function
// text is a fixed template (not derived from Epoch's data), so the output is
// byte-stable across runs whenever the underlying metadata doesn't change.

const EPOCH_BENCHMARKS_HEADER = `// AUTO-GENERATED by src/server/collectors/epoch.ts from Epoch AI's
// benchmark_data.zip (benchmark_metadata.csv). Do not edit by hand — re-run
// \`bun run collect\` (or \`bun run refresh\`) to refresh; the generator template
// lives in epoch.ts and rewrites this whole file each time it runs.
//
// Data: Epoch AI, https://epoch.ai/data/benchmark_data.zip, licensed CC-BY 4.0.
// Attribution required by the licence — keep this notice whenever this file
// (or data derived from it) is copied or redistributed.

export interface EpochBenchmark {
  /** Epoch's own benchmark name, e.g. "SWE-Bench verified". */
  benchmark: string;
  /** metric_snapshot.metric key this benchmark's scores are stored under —
   *  the source_file stem — or null when Epoch tracks the benchmark in its
   *  index but ships no per-model CSV for it (in_eci=False, source_file blank). */
  metric: string | null;
  in_eci: boolean;
  random_baseline: number | null;
  score_ceiling: number | null;
  release_date: string | null;
  superseded_by: string | null;
}
`;

const EPOCH_BENCHMARKS_TAIL = `
/**
 * Reports how saturated a benchmark's field is: the share of observed scores
 * sitting within nearCeilingFraction of the benchmark's ceiling. A high
 * share means the benchmark stopped discriminating between models — the same
 * problem as a field bunching at a benchmark's ceiling —
 * and is a data-driven cue to stop trusting headline differences on it (or to
 * flag it as a candidate for retirement, alongside an explicit \`superseded_by\`).
 *
 * Returns null when the benchmark carries no ceiling or no scores were given
 * — there is nothing to be "close to" in either case.
 */
export function benchmarkSaturation(
  benchmark: Pick<EpochBenchmark, "score_ceiling">,
  scores: number[],
  nearCeilingFraction = 0.95,
): { nearCeilingShare: number; saturated: boolean } | null {
  if (benchmark.score_ceiling === null || scores.length === 0) return null;
  const threshold = benchmark.score_ceiling * nearCeilingFraction;
  const nearCeiling = scores.filter((score) => score >= threshold).length;
  const nearCeilingShare = nearCeiling / scores.length;
  // "Saturated" when at least half the field is bunched near the ceiling —
  // a handful of frontier models maxing out a benchmark isn't saturation,
  // most of the field doing so is.
  return { nearCeilingShare, saturated: nearCeilingShare >= 0.5 };
}
`;

async function writeEpochBenchmarksSnapshot(rows: BenchmarkIndexRow[]): Promise<void> {
  const data: EpochBenchmark[] = rows.map((row) => ({
    benchmark: row.benchmark,
    metric: row.source_file ? metricNameOf(row.source_file) : null,
    in_eci: row.in_eci,
    random_baseline: row.random_baseline,
    score_ceiling: row.score_ceiling,
    release_date: row.release_date,
    superseded_by: row.superseded_by,
  }));

  const body =
    EPOCH_BENCHMARKS_HEADER +
    `\nexport const EPOCH_BENCHMARKS: EpochBenchmark[] = ${JSON.stringify(data, null, 2)};\n` +
    EPOCH_BENCHMARKS_TAIL;

  const outFile = path.join(import.meta.dirname, "epoch-benchmarks.ts");
  await fs.writeFile(outFile, body);
}

// ── Per-benchmark score extraction ───────────────────────────────────────────

const MODEL_VERSION_COLUMN = "Model version";

export interface ScoreRow {
  baseId: string;
  /** Null for a bare id, an "_unknown" tier, or a label that names no known effort. */
  effort: Thinking | null;
  rank: number;
  value: number;
}

/**
 * One row per (base model, effort) of a benchmark file, in file order. The effort comes from the
 * `Model version` suffix; a bare id falls back to `levelColumn` (Epoch's free-text label, e.g.
 * "Extra High") when the file has one. A repeated (model, effort) keeps the first row seen.
 */
export function extractScoreRows(
  csv: string,
  scoreColumn: string,
  scale: number,
  levelColumn?: string,
): ScoreRow[] {
  const seen = new Set<string>();
  const rows: ScoreRow[] = [];
  for (const record of parseCsvRecords(csv)) {
    const rawId = (record[MODEL_VERSION_COLUMN] ?? "").trim();
    if (!rawId) continue;

    const rawScore = record[scoreColumn];
    if (rawScore === undefined) continue;
    const parsed = parseFloatOrNull(rawScore);
    // A missing/blank score is not a zero — never emit a row for one.
    if (parsed === null) continue;

    const strip = stripEffortSuffix(rawId);
    const hasSuffix = strip.baseId !== rawId;
    const label = levelColumn && !hasSuffix ? (record[levelColumn] ?? "") : "";
    const effort = hasSuffix ? strip.effort : normalizeEffortLabel(label);
    const key = `${strip.baseId}\u0000${effort ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      baseId: strip.baseId,
      effort,
      rank: hasSuffix ? strip.rank : rankOfEffort(effort),
      value: parsed * scale,
    });
  }
  return rows;
}

/** The highest-effort row per base model: the unconditioned headline value. */
export function topTierRows(rows: readonly ScoreRow[]): ScoreRow[] {
  const best = new Map<string, ScoreRow>();
  for (const row of rows) {
    const existing = best.get(row.baseId);
    if (!existing || row.rank > existing.rank) best.set(row.baseId, row);
  }
  return [...best.values()];
}

export function extractScores(
  csv: string,
  scoreColumn: string,
  scale: number,
): Map<string, { value: number; rank: number }> {
  return new Map(
    topTierRows(extractScoreRows(csv, scoreColumn, scale)).map((r) => [
      r.baseId,
      { value: r.value, rank: r.rank },
    ]),
  );
}

// ── Files benchmark_metadata.csv does not list ───────────────────────────────
// Epoch ships per-model CSVs for benchmarks its index marks `source_file` blank
// (in_eci=False), so the index-driven loop never reads them. This is the small explicit
// registry for the ones modelpick wants: file, score column, scale, and sibling columns
// (cost/tokens/steps) stored as their own metrics. A file the index starts listing itself
// is read through the index only. Metric names follow the index rule (file stem).

export interface EpochExtraFile {
  file: string;
  scoreColumn: string;
  scale: number;
  /** Free-text effort label, used only for a `Model version` with no effort suffix. */
  levelColumn?: string;
  /** Sibling numeric columns, each stored as `<file stem>_<metricSuffix>`. */
  extras?: ReadonlyArray<{ column: string; metricSuffix: string }>;
}

export const EPOCH_EXTRA_FILES: readonly EpochExtraFile[] = [
  {
    file: "cursorbench_external.csv",
    scoreColumn: "Score",
    scale: 1,
    levelColumn: "Reasoning level",
    extras: [
      { column: "Cost per task", metricSuffix: "cost_per_task" },
      { column: "Tokens per task", metricSuffix: "tokens_per_task" },
      { column: "Steps per task", metricSuffix: "steps_per_task" },
    ],
  },
  { file: "scicode_external.csv", scoreColumn: "Score", scale: 1 },
  { file: "webdev_arena_external.csv", scoreColumn: "Arena Score", scale: 1 },
  { file: "swe_bench_verified.csv", scoreColumn: "Best score (across scorers)", scale: 1 },
];

interface ScoreSource {
  file: string;
  metric: string;
  scoreColumn: string;
  scale: number;
  levelColumn?: string | undefined;
}

/** Every (file, metric, column) to ingest: the index's entries, then the registry's. */
export function scoreSources(index: readonly BenchmarkIndexRow[]): ScoreSource[] {
  const fromIndex: ScoreSource[] = index.flatMap((row) =>
    row.source_file && row.score_column
      ? [{ file: row.source_file, metric: metricNameOf(row.source_file), scoreColumn: row.score_column, scale: row.scale }]
      : [],
  );
  const listed = new Set(fromIndex.map((s) => s.file));
  const fromRegistry = EPOCH_EXTRA_FILES.filter((x) => !listed.has(x.file)).flatMap((x): ScoreSource[] => {
    const metric = metricNameOf(x.file);
    return [
      { file: x.file, metric, scoreColumn: x.scoreColumn, scale: x.scale, levelColumn: x.levelColumn },
      ...(x.extras ?? []).map((e) => ({
        file: x.file,
        metric: `${metric}_${e.metricSuffix}`,
        scoreColumn: e.column,
        scale: 1,
        levelColumn: x.levelColumn,
      })),
    ];
  });
  return [...fromIndex, ...fromRegistry];
}

/**
 * Every effort tier as a row carrying its effort in `conditions`, plus the top tier as the
 * unconditioned row (a bare id yields only that one). Pure so it is testable without the zip.
 */
export function metricsForRows(input: {
  rows: readonly ScoreRow[];
  metric: string;
  resolve: IdResolver;
  unmatched: Map<string, { externalId: string; name: string }>;
}): NormalizedMetric[] {
  const { rows, metric, resolve, unmatched } = input;
  const out: NormalizedMetric[] = [];
  const emit = (row: ScoreRow, conditions: Thinking | null) => {
    const localId = resolve(row.baseId);
    if (!localId) {
      // Deduped across benchmarks: the same unresolved external id would
      // otherwise repeat once per benchmark it appears in (~80 files).
      if (!unmatched.has(row.baseId)) unmatched.set(row.baseId, { externalId: row.baseId, name: row.baseId });
      return;
    }
    // Individual Inspect-AI evals, not a composite index like AA's — one
    // real sample per benchmark rather than an aggregate confidence score.
    out.push({ model_id: localId, source: "epoch", metric, value: row.value, confidence: 0.85, conditions });
  };
  for (const row of topTierRows(rows)) emit(row, null);
  for (const row of rows) if (row.effort !== null) emit(row, row.effort);
  return out;
}

// ── Collector entrypoint ─────────────────────────────────────────────────────

/**
 * Reads every score source (index + registry) out of an unzipped export. A file missing from
 * the export or one that fails to parse is warned about and skipped, never a failed run.
 */
export async function readMetricsFromDir(input: {
  dir: string;
  index: readonly BenchmarkIndexRow[];
  resolve: IdResolver;
}): Promise<CollectorResult> {
  const { dir, index, resolve } = input;
  const metrics: NormalizedMetric[] = [];
  const unmatchedById = new Map<string, { externalId: string; name: string }>();
  const csvByFile = new Map<string, string | null>();
  for (const source of scoreSources(index)) {
    if (!csvByFile.has(source.file)) {
      try {
        csvByFile.set(source.file, await fs.readFile(path.join(dir, source.file), "utf-8"));
      } catch (err) {
        console.warn(`[epoch] ${source.file} missing: ${String(err)} — skipping benchmark`);
        csvByFile.set(source.file, null);
      }
    }
    const csv = csvByFile.get(source.file);
    if (csv === null || csv === undefined) continue;

    let rows: ScoreRow[];
    try {
      rows = extractScoreRows(csv, source.scoreColumn, source.scale, source.levelColumn);
    } catch (err) {
      console.warn(`[epoch] failed to parse ${source.file}: ${String(err)} — skipping`);
      continue;
    }
    metrics.push(...metricsForRows({ rows, metric: source.metric, resolve, unmatched: unmatchedById }));
  }
  return { metrics, unmatched: [...unmatchedById.values()] };
}

export async function collectEpoch(resolve: IdResolver): Promise<CollectorResult> {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "modelpick-epoch-"));
  const zipPath = path.join(workDir, "benchmark_data.zip");
  const extractDir = path.join(workDir, "extracted");

  try {
    let buffer: ArrayBuffer;
    try {
      const resp = await fetch(EPOCH_ZIP_URL);
      if (!resp.ok) {
        console.warn(`[epoch] HTTP ${resp.status} — skipping`);
        return { metrics: [], unmatched: [] };
      }
      buffer = await resp.arrayBuffer();
    } catch (err) {
      console.warn(`[epoch] fetch error: ${String(err)} — skipping`);
      return { metrics: [], unmatched: [] };
    }

    await fs.writeFile(zipPath, Buffer.from(buffer));
    await fs.mkdir(extractDir, { recursive: true });
    try {
      await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", extractDir]);
    } catch (err) {
      console.warn(`[epoch] unzip failed: ${String(err)} — skipping`);
      return { metrics: [], unmatched: [] };
    }

    let indexCsv: string;
    try {
      indexCsv = await fs.readFile(path.join(extractDir, "benchmark_metadata.csv"), "utf-8");
    } catch (err) {
      console.warn(`[epoch] benchmark_metadata.csv missing: ${String(err)} — skipping`);
      return { metrics: [], unmatched: [] };
    }

    const index = parseBenchmarkIndex(indexCsv);

    try {
      await writeEpochBenchmarksSnapshot(index);
    } catch (err) {
      console.warn(`[epoch] failed to write epoch-benchmarks.ts snapshot: ${String(err)}`);
    }

    return await readMetricsFromDir({ dir: extractDir, index, resolve });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
