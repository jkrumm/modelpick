import { resolveModelId } from "./normalize.js";
import type { CollectorResult, NormalizedMetric } from "./normalize.js";

interface AAEvaluations {
  artificial_analysis_intelligence_index?: number | null;
  artificial_analysis_coding_index?: number | null;
}

interface AAPricing {
  price_1m_input_tokens?: number | null;
  price_1m_output_tokens?: number | null;
}

interface AAModel {
  id: string;
  name: string;
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
  if (value !== null && value !== undefined && isFinite(value)) {
    metrics.push({ model_id, source: "artificialanalysis", metric, value, confidence });
  }
}

export async function collectArtificialAnalysis(): Promise<CollectorResult> {
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
    const localId = resolveModelId(model.id);
    if (!localId) {
      unmatched.push({ externalId: model.id, name: model.name });
      continue;
    }

    addMetric(
      metrics,
      localId,
      "quality",
      model.evaluations?.artificial_analysis_intelligence_index,
      0.9,
    );
    addMetric(
      metrics,
      localId,
      "throughput",
      model.median_output_tokens_per_second,
      0.9,
    );
    addMetric(
      metrics,
      localId,
      "latency_p50",
      model.median_time_to_first_token_seconds,
      0.9,
    );
    // Prices already in per-million-token units from AA
    addMetric(metrics, localId, "price_in", model.pricing?.price_1m_input_tokens, 0.9);
    addMetric(metrics, localId, "price_out", model.pricing?.price_1m_output_tokens, 0.9);
  }

  return { metrics, unmatched };
}
