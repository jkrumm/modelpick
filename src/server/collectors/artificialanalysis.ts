import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";

// Free-tier Data API. The legacy /api/v2/data/llms/models sunsets 2026-11-04 (410 after);
// the Pro list (/api/v2/language/models) 403s on our key. Free drops every per-benchmark
// eval (gpqa, hle, mmlu_pro, …) — Epoch covers those — and keeps the indices, pricing and
// speed, which is all the scorer reads from AA.
interface AAEvaluations {
  artificial_analysis_intelligence_index?: number | null;
  artificial_analysis_coding_index?: number | null;
}

interface AAPricing {
  price_1m_input_tokens?: number | null;
  price_1m_output_tokens?: number | null;
}

interface AAPerformance {
  median_output_tokens_per_second?: number | null;
  median_time_to_first_token_seconds?: number | null;
}

interface AAModel {
  id: string;
  name: string;
  slug?: string | null;
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

  for (const model of models) {
    // AA's `id` is a UUID; the human-readable identifier is `slug` (fall back to name).
    const externalId = model.slug ?? model.name;
    const localId = resolve(externalId);
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

  return { metrics, unmatched };
}
