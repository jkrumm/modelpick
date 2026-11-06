import type {
  AaVariantRow,
  CollectorResult,
  IdResolver,
  NormalizedMetric,
} from "./normalize.js";
import { SNAPSHOT_PINS } from "./snapshot-pins.js";
import { parseVariant, resolveEfforts } from "../efficiency/variants.js";

// Free-tier Data API. The legacy /api/v2/data/llms/models sunsets 2026-11-04 (410 after);
// the Pro list (/api/v2/language/models) 403s on our key. Free drops every per-benchmark
// eval (gpqa, hle, mmlu_pro, …) — Epoch covers those — and keeps the indices, pricing and
// speed, which is all the scorer reads from AA.
//
// Terms: use this API only, never scrape artificialanalysis.ai, and show attribution
// ("Source: Artificial Analysis (artificialanalysis.ai)") wherever the data is displayed.
interface AAEvaluations {
  artificial_analysis_intelligence_index?: number | null;
  artificial_analysis_coding_index?: number | null;
}

interface AAPricing {
  price_1m_input_tokens?: number | null;
  price_1m_output_tokens?: number | null;
  price_1m_cache_hit_tokens?: number | null;
  price_1m_cache_write_tokens?: number | null;
}

interface AAPerformance {
  median_output_tokens_per_second?: number | null;
  median_time_to_first_token_seconds?: number | null;
  median_time_to_first_answer_token_seconds?: number | null;
  median_end_to_end_response_time_seconds?: number | null;
}

interface AAModel {
  id: string;
  name: string;
  slug?: string | null;
  release_date?: string | null;
  model_creator?: { name?: string | null } | null;
  artificial_analysis_intelligence_index_cost?: {
    cost_per_task?: { total_cost?: number | null } | null;
  } | null;
  evaluations?: AAEvaluations | null;
  pricing?: AAPricing | null;
  performance?: AAPerformance | null;
}

interface AAPage {
  data?: AAModel[];
  pagination?: { has_more?: boolean } | null;
}

const AA_MODELS_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
// 4 pages of 200 today; the cap only guards against a has_more that never turns false.
const MAX_PAGES = 20;

export { SNAPSHOT_PINS };

async function fetchAllModels(key: string): Promise<AAModel[]> {
  const models: AAModel[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(`${AA_MODELS_URL}?page=${page}`, {
      headers: { "x-api-key": key },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} on page ${page}`);
    const body = (await resp.json()) as AAPage;
    models.push(...(body.data ?? []));
    if (!body.pagination?.has_more) break;
  }
  return models;
}

const num = (v: number | null | undefined): number | null =>
  v !== null && v !== undefined && isFinite(v) ? v : null;

/** One row per AA slug, effort parsed from the slug (bare slug: `max` or `default`). */
export function toVariantRows(models: AAModel[]): AaVariantRow[] {
  const efforts = resolveEfforts(models.flatMap((m) => (m.slug ? [{ slug: m.slug, name: m.name }] : [])));
  return models.flatMap((m): AaVariantRow[] => {
    if (!m.slug) return [];
    return [
      {
        slug: m.slug,
        name: m.name,
        lineage: parseVariant(m.slug).lineage,
        effort: efforts.get(m.slug) ?? "default",
        creator: m.model_creator?.name ?? "Unknown",
        release_date: m.release_date ?? null,
        intelligence: num(m.evaluations?.artificial_analysis_intelligence_index),
        cost_per_task: num(m.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost),
        price_in: num(m.pricing?.price_1m_input_tokens),
        price_out: num(m.pricing?.price_1m_output_tokens),
        price_cache_read: num(m.pricing?.price_1m_cache_hit_tokens),
        price_cache_write: num(m.pricing?.price_1m_cache_write_tokens),
        tps: num(m.performance?.median_output_tokens_per_second),
        ttft_sec: num(m.performance?.median_time_to_first_token_seconds),
        ttfat_sec: num(m.performance?.median_time_to_first_answer_token_seconds),
        e2e_sec: num(m.performance?.median_end_to_end_response_time_seconds),
      },
    ];
  });
}

function addMetric(
  metrics: NormalizedMetric[],
  model_id: string,
  metric: string,
  value: number | null | undefined,
  confidence: number,
): void {
  // AA genuinely has no sample for some model/eval pairs (returned as null, not 0).
  // A missing eval must produce no row at all — persisting 0 would read as "scored
  // zero" instead of "not measured" and would corrupt anything that averages it.
  if (value !== null && value !== undefined && isFinite(value)) {
    metrics.push({
      model_id,
      source: "artificialanalysis",
      metric,
      value,
      confidence,
    });
  }
}

export async function collectArtificialAnalysis(resolve: IdResolver): Promise<CollectorResult> {
  const key = process.env["ARTIFICIALANALYSIS_API_KEY"] ?? "";
  if (!key) {
    console.warn("[artificialanalysis] ARTIFICIALANALYSIS_API_KEY not set — skipping");
    return { metrics: [], unmatched: [] };
  }

  let models: AAModel[];
  try {
    models = await fetchAllModels(key);
  } catch (err) {
    console.warn(`[artificialanalysis] ${String(err)} — skipping`);
    return { metrics: [], unmatched: [] };
  }

  const metrics: NormalizedMetric[] = [];
  const unmatched: { externalId: string; name: string }[] = [];

  const pinnedSlugs = new Map(Object.entries(SNAPSHOT_PINS).map(([local, slug]) => [slug, local]));

  for (const model of models) {
    // AA's `id` is a UUID; the human-readable identifier is `slug` (fall back to name).
    const externalId = model.slug ?? model.name;
    const localId = pinnedSlugs.get(externalId) ?? resolve(externalId);
    // A pinned id takes its metrics from the pinned snapshot only — the undated slug
    // resolving to the same id would otherwise write the superseded scores beside it.
    if (localId && SNAPSHOT_PINS[localId] && SNAPSHOT_PINS[localId] !== externalId) continue;
    if (!localId) {
      unmatched.push({ externalId, name: model.name });
      continue;
    }

    addMetric(
      metrics,
      localId,
      "quality",
      model.evaluations?.artificial_analysis_intelligence_index,
      0.9,
    );
    // Coding-specific index — diverges from general intelligence (a model can be
    // smart but a weak coder), so the "coding" category ranks on this instead.
    addMetric(
      metrics,
      localId,
      "coding_index",
      model.evaluations?.artificial_analysis_coding_index,
      0.9,
    );
    addMetric(
      metrics,
      localId,
      "throughput",
      model.performance?.median_output_tokens_per_second,
      0.9,
    );
    addMetric(
      metrics,
      localId,
      "latency_p50",
      model.performance?.median_time_to_first_token_seconds,
      0.9,
    );
    // Prices already in per-million-token units from AA
    addMetric(metrics, localId, "price_in", model.pricing?.price_1m_input_tokens, 0.9);
    addMetric(metrics, localId, "price_out", model.pricing?.price_1m_output_tokens, 0.9);
  }

  return { metrics, unmatched, aaVariants: toVariantRows(models) };
}
