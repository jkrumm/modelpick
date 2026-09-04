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
 * CSV — captured in the snapshot with `metric: null`, no rows ingested.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
// Decision: keep exactly one row per base model per benchmark, the *highest*
// available effort tier — that's what a model's headline leaderboard number
// means once effort tiers exist at all. "none"/"unknown" (and a bare Model
// version with no matching suffix at all — e.g. a model with no reasoning
// dimension) rank equally at the bottom: none of them claims an elevated
// effort setting, so all defer to any explicit low/medium/high/xhigh/max row
// for the same model, and any one of them survives on its own if that's
// genuinely the only measurement available. Ties keep whichever was seen
// first in the file, for determinism.
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

export interface EffortStrip {
  baseId: string;
  rank: number;
}

export function stripEffortSuffix(modelVersion: string): EffortStrip {
  const match = EFFORT_SUFFIX_RE.exec(modelVersion);
  if (!match) return { baseId: modelVersion, rank: NO_SUFFIX_RANK };
  const tier = (match[1] ?? "").toLowerCase();
  return {
    baseId: modelVersion.slice(0, match.index),
    rank: EFFORT_RANK[tier] ?? NO_SUFFIX_RANK,
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

export function metricNameOf(sourceFile: string): string {
  return sourceFile.replace(/\.csv$/i, "");
}

// ── Generated snapshot (src/server/collectors/epoch-benchmarks.ts) ──────────
// Regenerated wholesale on every collection run — same shape as
// src/db/iu-catalog.ts's relationship to import-portal.ts. The helper function
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
 * problem ccbench watches for when a field bunches at a task's max score —
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

export function extractScores(
  csv: string,
  scoreColumn: string,
  scale: number,
): Map<string, { value: number; rank: number }> {
  const best = new Map<string, { value: number; rank: number }>();
  for (const record of parseCsvRecords(csv)) {
    const rawId = (record[MODEL_VERSION_COLUMN] ?? "").trim();
    if (!rawId) continue;

    const rawScore = record[scoreColumn];
    if (rawScore === undefined) continue;
    const parsed = parseFloatOrNull(rawScore);
    // A missing/blank score is not a zero — never emit a row for one.
    if (parsed === null) continue;

    const { baseId, rank } = stripEffortSuffix(rawId);
    const existing = best.get(baseId);
    if (!existing || rank > existing.rank) {
      best.set(baseId, { value: parsed * scale, rank });
    }
  }
  return best;
}

// ── Collector entrypoint ─────────────────────────────────────────────────────

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

    const metrics: NormalizedMetric[] = [];
    const unmatchedById = new Map<string, { externalId: string; name: string }>();

    for (const row of index) {
      if (!row.source_file || !row.score_column) continue;

      let csv: string;
      try {
        csv = await fs.readFile(path.join(extractDir, row.source_file), "utf-8");
      } catch (err) {
        console.warn(`[epoch] ${row.source_file} missing: ${String(err)} — skipping benchmark`);
        continue;
      }

      let scores: Map<string, { value: number; rank: number }>;
      try {
        scores = extractScores(csv, row.score_column, row.scale);
      } catch (err) {
        console.warn(`[epoch] failed to parse ${row.source_file}: ${String(err)} — skipping`);
        continue;
      }

      const metric = metricNameOf(row.source_file);
      for (const [baseId, { value }] of scores) {
        const localId = resolve(baseId);
        if (!localId) {
          // Deduped across benchmarks: the same unresolved external id would
          // otherwise repeat once per benchmark it appears in (~80 files).
          if (!unmatchedById.has(baseId)) {
            unmatchedById.set(baseId, { externalId: baseId, name: baseId });
          }
          continue;
        }
        // Individual Inspect-AI evals, not a composite index like AA's — one
        // real sample per benchmark rather than an aggregate confidence score.
        metrics.push({ model_id: localId, source: "epoch", metric, value, confidence: 0.85 });
      }
    }

    return { metrics, unmatched: [...unmatchedById.values()] };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
