/**
 * Collects Arena Elo ratings from LMArena's official leaderboard export via
 * the Hugging Face datasets-server (no auth) — the same public dataset
 * lmarena.ai's own site reads. Licence: CC BY 4.0, same as epoch.ts's Epoch AI
 * data — attribution is a licence condition, not a nicety; keep this notice
 * if this data (or data derived from it) is copied elsewhere.
 *
 * Arena ids carry a HYPHENATED reasoning-effort suffix (`claude-opus-4-6-high`,
 * `gemini-3.5-flash-medium`). Epoch's `stripEffortSuffix` matches the
 * underscore form only, deliberately, so it does not apply here and this file
 * strips its own.
 *
 * It strips only as a FALLBACK, after an exact resolve of the raw name has
 * failed, because a hyphenated `-max` is ambiguous: `claude-opus-5-max` is an
 * effort tier, `qwen3.8-max` is a model name. Resolving raw-first keeps the
 * genuine `-max` families intact and only truncates ids the catalog doesn't
 * know under their full name.
 *
 * This matters for the headline numbers, not just for coverage: arena ranks
 * `claude-opus-4-6-high` at 1504.7 and the unsuffixed `claude-opus-4-6` at
 * 1484.3 on `creative_writing`. Dropping the suffixed row silently understates
 * every model that is measured mainly under an effort tier.
 */
import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";

const HF_FILTER_URL = "https://datasets-server.huggingface.co/filter";
const DATASET = "lmarena-ai/leaderboard-dataset";
const PAGE_SIZE = 100;
const MIN_VOTE_COUNT = 100; // rows below this are too thin to rank on — dropped entirely
const HIGH_CONFIDENCE_VOTE_COUNT = 500;
// The datasets-server rebuilds its index unpredictably and answers
// "the dataset index is loading" as an HTTP 500 while it does — observed
// mid-pagination on a different page each run. It clears on its own, so retry
// with a growing delay rather than giving up on the first failure.
const RETRY_DELAYS_MS = [5000, 15000];
// Back-to-back page requests get answered with that same 500 far more often
// than spaced ones do — the failures land on the second page of a category,
// never the first. Pace the pagination instead of retrying into a rate limit.
const PAGE_DELAY_MS = 1500;
const ARENA_EFFORT_SUFFIX_RE = /-(max|xhigh|high|medium|low|minimal|thinking)$/i;

/** Resolves an arena model name to a local catalog id: exact name first, then
 *  the name with its trailing effort tier removed. Returns the id that matched
 *  and the name to record when nothing did. */
function resolveArenaId(
  modelName: string,
  resolve: IdResolver,
): { localId: string | null; externalId: string } {
  const direct = resolve(modelName);
  if (direct) return { localId: direct, externalId: modelName };

  const base = modelName.replace(ARENA_EFFORT_SUFFIX_RE, "");
  if (base === modelName) return { localId: null, externalId: modelName };
  return { localId: resolve(base) ?? null, externalId: base };
}

interface CategoryConfig {
  category: string;
  metric: string;
}

const CATEGORIES: CategoryConfig[] = [
  { category: "overall", metric: "arena_elo" },
  { category: "creative_writing", metric: "arena_creative_writing" },
  { category: "german", metric: "arena_german" },
  { category: "instruction_following", metric: "arena_instruction_following" },
  { category: "coding", metric: "arena_coding" },
];

interface LmArenaRow {
  row_idx: number;
  row: {
    model_name: string;
    organization: string;
    license: string;
    rating: number;
    rating_lower: number;
    rating_upper: number;
    variance: number;
    vote_count: number;
    rank: number;
    category: string;
    leaderboard_publish_date: string;
  };
}

interface LmArenaFilterResponse {
  rows?: LmArenaRow[];
  num_rows_total?: number;
  error?: string;
}

function buildUrl(category: string, offset: number): string {
  const params = new URLSearchParams({
    dataset: DATASET,
    config: "text",
    split: "latest",
    where: `"category"='${category}'`,
    offset: String(offset),
    length: String(PAGE_SIZE),
  });
  return `${HF_FILTER_URL}?${params.toString()}`;
}

async function fetchPage(category: string, offset: number): Promise<LmArenaFilterResponse | null> {
  try {
    const resp = await fetch(buildUrl(category, offset));
    if (!resp.ok) {
      console.warn(`[lmarena] HTTP ${resp.status} for "${category}" offset ${offset}`);
      return null;
    }
    return (await resp.json()) as LmArenaFilterResponse;
  } catch (err) {
    console.warn(`[lmarena] fetch error for "${category}" offset ${offset}: ${String(err)}`);
    return null;
  }
}

interface Page {
  rows: LmArenaRow[];
  numRowsTotal: number;
}

/** Fetches one page, retrying on any failure — the "index is loading" error
 *  arrives as an HTTP 500 with no `rows`, so both shapes get the same
 *  treatment. Returns null once the retries are exhausted. */
async function fetchPageWithRetry(category: string, offset: number): Promise<Page | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const data = await fetchPage(category, offset);
    if (data !== null && data.error === undefined && data.rows !== undefined) {
      return { rows: data.rows, numRowsTotal: data.num_rows_total ?? data.rows.length };
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    console.warn(
      `[lmarena] "${category}" offset ${offset}: ${data?.error ?? "request failed"} — retrying in ${delay}ms`,
    );
    await new Promise((res) => setTimeout(res, delay));
  }
  console.warn(`[lmarena] "${category}" offset ${offset}: giving up on this page`);
  return null;
}

/** Paginates a whole category, KEEPING whatever pages succeeded. A failed page
 *  costs the models on it and nothing else: every row carries its own rating,
 *  so a partial pull is incomplete, never wrong. Dropping the category instead
 *  would mean one flaky page loses `arena_german` for the whole refresh. */
async function fetchCategory(category: string): Promise<LmArenaRow[]> {
  const rows: LmArenaRow[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    if (offset > 0) await new Promise((res) => setTimeout(res, PAGE_DELAY_MS));
    const page = await fetchPageWithRetry(category, offset);
    if (page === null) {
      console.warn(
        `[lmarena] "${category}": page at offset ${offset} unavailable — keeping the ${rows.length} rows fetched so far`,
      );
      // No successful page yet means `total` is still unknown, so there is no
      // end condition to walk towards — stop rather than page forever.
      if (total === Infinity) break;
      offset += PAGE_SIZE;
      continue;
    }
    rows.push(...page.rows);
    total = page.numRowsTotal;
    if (page.rows.length === 0) break; // safety valve against a stuck total
    offset += PAGE_SIZE;
  }

  return rows;
}

export async function collectLmarena(resolve: IdResolver): Promise<CollectorResult> {
  const metrics: NormalizedMetric[] = [];
  const unmatchedById = new Map<string, { externalId: string; name: string }>();

  for (const { category, metric } of CATEGORIES) {
    const rows = await fetchCategory(category);
    if (rows.length === 0) {
      console.warn(`[lmarena] category "${category}" returned no rows — continuing with the rest`);
      continue;
    }

    // Highest-rating source row per resolved local id for this metric — an
    // arena id can repeat across reasoning-effort variants (or an unsuffixed
    // and a suffixed row both resolving to the same catalog id).
    const bestByLocalId = new Map<string, { rating: number; confidence: number }>();

    for (const { row } of rows) {
      if (row.vote_count < MIN_VOTE_COUNT) continue;

      const { localId, externalId } = resolveArenaId(row.model_name, resolve);
      if (!localId) {
        if (!unmatchedById.has(externalId)) {
          unmatchedById.set(externalId, { externalId, name: row.model_name });
        }
        continue;
      }

      const confidence = row.vote_count >= HIGH_CONFIDENCE_VOTE_COUNT ? 0.85 : 0.7;
      const existing = bestByLocalId.get(localId);
      if (!existing || row.rating > existing.rating) {
        bestByLocalId.set(localId, { rating: row.rating, confidence });
      }
    }

    for (const [localId, { rating, confidence }] of bestByLocalId) {
      metrics.push({ model_id: localId, source: "lmarena", metric, value: rating, confidence });
    }
  }

  return { metrics, unmatched: [...unmatchedById.values()] };
}
