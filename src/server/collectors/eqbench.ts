/**
 * Collects creative-writing leaderboard scores from the EQ-Bench site repo
 * (https://github.com/EQ-bench/EQ-bench-site), fetched at HEAD via
 * raw.githubusercontent.com — no auth, no key, but also no pin: the repo is
 * live and this collector always reads whatever HEAD currently serves, so
 * re-fetch every run rather than caching or pinning a commit.
 *
 * Both leaderboards are LLM-judged (judge: Claude Sonnet, per
 * eqbench.com/about.html) on English-only prompts — a judged rubric, not a
 * measured eval like epoch.ts's Inspect-AI transcripts. `slop_score` and
 * `repetition_score` are LOWER-is-better; every other metric here (including
 * `longform_writing`) is higher-is-better — the one inversion in this
 * collector worth remembering when reading the benchmarks matrix.
 *
 * Each source file is a website JS file wrapping the leaderboard's CSV as a
 * template literal (`let leaderboardDataXxxV3 = \`...\`;`). Real markup and
 * further JS follow the closing backtick with no `;` immediately after it, so
 * extraction slices by index (assignment -> first backtick -> next backtick)
 * rather than a regex anchored on a trailing `;`.
 */
import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";
import { parseCsv } from "./epoch.js";

const CREATIVE_WRITING_URL =
  "https://raw.githubusercontent.com/EQ-bench/EQ-bench-site/HEAD/creative_writing.js";
const LONGFORM_URL =
  "https://raw.githubusercontent.com/EQ-bench/EQ-bench-site/HEAD/creative_writing_longform.js";

const CREATIVE_WRITING_VAR = "leaderboardDataCreativeWritingV3";
const LONGFORM_VAR = "leaderboardDataLongformV3";

/**
 * Extracts the CSV embedded in `let <varName> = \`...\`` from a website JS
 * file. The file contains far more JS/HTML after the closing backtick, so
 * this slices by index instead of regex-matching to a trailing `;` (there
 * isn't one right after the closing backtick).
 */
export function extractEmbeddedCsv(js: string, varName: string): string | null {
  const assignIdx = js.indexOf(`let ${varName} =`);
  if (assignIdx === -1) return null;
  const openIdx = js.indexOf("`", assignIdx);
  if (openIdx === -1) return null;
  const closeIdx = js.indexOf("`", openIdx + 1);
  if (closeIdx === -1) return null;
  return js.slice(openIdx + 1, closeIdx).replace(/^\n/, "");
}

/** Parses CSV by header name, dropping any row whose cell count doesn't match
 *  the header (a ragged row from a hand-edited leaderboard file). Unlike
 *  epoch.ts's `parseCsvRecords`, this never pads a short row — a header-shaped
 *  record built from a mismatched row would silently misattribute values. */
function parseLeaderboardCsv(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) return [];
  const records: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (row.length !== header.length) continue;
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] ?? "";
    });
    records.push(record);
  }
  return records;
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

interface MetricSpec {
  column: string;
  metric: string;
}

// column -> metric name, per leaderboard. vocab_complexity is only emitted
// for the short-form leaderboard even though the longform CSV also carries
// the column — the longform file's own metric set is deliberately narrower.
const CREATIVE_WRITING_METRICS: MetricSpec[] = [
  { column: "elo_score", metric: "creative_writing_elo" },
  { column: "creative_writing_score", metric: "creative_writing_rubric" },
  { column: "slop_score", metric: "slop_score" },
  { column: "repetition_score", metric: "repetition_score" },
  { column: "vocab_complexity", metric: "vocab_complexity" },
];

const LONGFORM_METRICS: MetricSpec[] = [
  { column: "overall_score_100", metric: "longform_writing" },
  { column: "slop_score", metric: "longform_slop_score" },
];

const CONFIDENCE = 0.8;

/** Parses one leaderboard CSV into metrics, keeping only the highest-
 *  `primaryColumn` source row per resolved local model id (mirrors epoch.ts's
 *  one-row-per-model rule — a model can otherwise appear more than once, e.g.
 *  a "*"-marked new entry alongside a stale row from the same export). */
function collectFromCsv(
  csv: string,
  primaryColumn: string,
  metricSpecs: MetricSpec[],
  resolve: IdResolver,
): CollectorResult {
  const bestByLocalId = new Map<string, { primary: number; record: Record<string, string> }>();
  const unmatchedById = new Map<string, { externalId: string; name: string }>();

  for (const record of parseLeaderboardCsv(csv)) {
    let rawName = (record["model_name"] ?? "").trim();
    if (rawName.length === 0) continue;
    if (rawName.startsWith("*")) rawName = rawName.slice(1);

    const primary = parseNum(record[primaryColumn]);
    if (primary === null) continue;

    const localId = resolve(rawName);
    if (!localId) {
      if (!unmatchedById.has(rawName)) {
        unmatchedById.set(rawName, { externalId: rawName, name: rawName });
      }
      continue;
    }

    const existing = bestByLocalId.get(localId);
    if (!existing || primary > existing.primary) {
      bestByLocalId.set(localId, { primary, record });
    }
  }

  const metrics: NormalizedMetric[] = [];
  for (const [localId, { record }] of bestByLocalId) {
    for (const spec of metricSpecs) {
      const value = parseNum(record[spec.column]);
      if (value === null) continue;
      metrics.push({
        model_id: localId,
        source: "eqbench",
        metric: spec.metric,
        value,
        confidence: CONFIDENCE,
      });
    }
  }

  return { metrics, unmatched: [...unmatchedById.values()] };
}

async function fetchEmbeddedCsv(
  url: string,
  varName: string,
  label: string,
): Promise<string | null> {
  let js: string;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[eqbench] HTTP ${resp.status} fetching ${label} — skipping`);
      return null;
    }
    js = await resp.text();
  } catch (err) {
    console.warn(`[eqbench] fetch error for ${label}: ${String(err)} — skipping`);
    return null;
  }

  const csv = extractEmbeddedCsv(js, varName);
  if (csv === null) {
    console.warn(`[eqbench] could not locate embedded CSV in ${label} — skipping`);
  }
  return csv;
}

export async function collectEqbench(resolve: IdResolver): Promise<CollectorResult> {
  const [creativeCsv, longformCsv] = await Promise.all([
    fetchEmbeddedCsv(CREATIVE_WRITING_URL, CREATIVE_WRITING_VAR, "creative_writing.js"),
    fetchEmbeddedCsv(LONGFORM_URL, LONGFORM_VAR, "creative_writing_longform.js"),
  ]);

  const metrics: NormalizedMetric[] = [];
  const unmatchedById = new Map<string, { externalId: string; name: string }>();

  if (creativeCsv !== null) {
    const result = collectFromCsv(creativeCsv, "elo_score", CREATIVE_WRITING_METRICS, resolve);
    metrics.push(...result.metrics);
    for (const u of result.unmatched) unmatchedById.set(u.externalId, u);
  }
  if (longformCsv !== null) {
    const result = collectFromCsv(longformCsv, "overall_score_100", LONGFORM_METRICS, resolve);
    metrics.push(...result.metrics);
    for (const u of result.unmatched) unmatchedById.set(u.externalId, u);
  }

  return { metrics, unmatched: [...unmatchedById.values()] };
}
