import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";

interface AAEvaluations {
  artificial_analysis_intelligence_index?: number | null;
  artificial_analysis_coding_index?: number | null;
  artificial_analysis_math_index?: number | null;
  mmlu_pro?: number | null;
  gpqa?: number | null;
  hle?: number | null;
  livecodebench?: number | null;
  scicode?: number | null;
  math_500?: number | null;
  aime?: number | null;
  aime_25?: number | null;
  ifbench?: number | null;
  lcr?: number | null;
  terminalbench_hard?: number | null;
  terminalbench_v2_1?: number | null;
  tau2?: number | null;
  tau_banking?: number | null;
}

interface AAPricing {
  price_1m_input_tokens?: number | null;
  price_1m_output_tokens?: number | null;
}

interface AAModel {
  id: string;
  name: string;
  slug?: string | null;
  evaluations?: AAEvaluations | null;
  pricing?: AAPricing | null;
  median_output_tokens_per_second?: number | null;
  median_time_to_first_token_seconds?: number | null;
}

const AA_MODELS_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";

// API may return a direct array or a wrapped object
function extractModels(raw: unknown): AAModel[] {
  if (Array.isArray(raw)) return raw as AAModel[];
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["models"])) return obj["models"] as AAModel[];
    if (Array.isArray(obj["data"])) return obj["data"] as AAModel[];
  }
  return [];
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
    metrics.push({ model_id, source: "artificialanalysis", metric, value, confidence });
  }
}

export async function collectArtificialAnalysis(resolve: IdResolver): Promise<CollectorResult> {
  const key = process.env["ARTIFICIALANALYSIS_API_KEY"] ?? "";
  if (!key) {
    console.warn("[artificialanalysis] ARTIFICIALANALYSIS_API_KEY not set — skipping");
    return { metrics: [], unmatched: [] };
  }

  let raw: unknown;
  try {
    const resp = await fetch(AA_MODELS_URL, {
      headers: { "x-api-key": key },
    });
    if (!resp.ok) {
      console.warn(`[artificialanalysis] HTTP ${resp.status} — skipping`);
      return { metrics: [], unmatched: [] };
    }
    raw = await resp.json();
  } catch (err) {
    console.warn(`[artificialanalysis] fetch error: ${String(err)} — skipping`);
    return { metrics: [], unmatched: [] };
  }

  const models = extractModels(raw);
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
    addMetric(metrics, localId, "math_index", model.evaluations?.artificial_analysis_math_index, 0.9);
    // Remaining AA evals: metric names mirror AA's own field names verbatim — they're
    // already short, stable benchmark identifiers with no ambiguity to resolve.
    addMetric(metrics, localId, "mmlu_pro", model.evaluations?.mmlu_pro, 0.9);
    addMetric(metrics, localId, "gpqa", model.evaluations?.gpqa, 0.9);
    addMetric(metrics, localId, "hle", model.evaluations?.hle, 0.9);
    addMetric(metrics, localId, "livecodebench", model.evaluations?.livecodebench, 0.9);
    addMetric(metrics, localId, "scicode", model.evaluations?.scicode, 0.9);
    addMetric(metrics, localId, "math_500", model.evaluations?.math_500, 0.9);
    addMetric(metrics, localId, "aime", model.evaluations?.aime, 0.9);
    addMetric(metrics, localId, "aime_25", model.evaluations?.aime_25, 0.9);
    addMetric(metrics, localId, "ifbench", model.evaluations?.ifbench, 0.9);
    addMetric(metrics, localId, "lcr", model.evaluations?.lcr, 0.9);
    addMetric(metrics, localId, "terminalbench_hard", model.evaluations?.terminalbench_hard, 0.9);
    addMetric(
      metrics,
      localId,
      "terminalbench_v2_1",
      model.evaluations?.terminalbench_v2_1,
      0.9,
    );
    addMetric(metrics, localId, "tau2", model.evaluations?.tau2, 0.9);
    addMetric(metrics, localId, "tau_banking", model.evaluations?.tau_banking, 0.9);
    addMetric(metrics, localId, "throughput", model.median_output_tokens_per_second, 0.9);
    addMetric(metrics, localId, "latency_p50", model.median_time_to_first_token_seconds, 0.9);
    // Prices already in per-million-token units from AA
    addMetric(metrics, localId, "price_in", model.pricing?.price_1m_input_tokens, 0.9);
    addMetric(metrics, localId, "price_out", model.pricing?.price_1m_output_tokens, 0.9);
  }

  return { metrics, unmatched };
}
