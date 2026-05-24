import { resolveModelId } from "./normalize.js";
import type { CollectorResult, NormalizedMetric } from "./normalize.js";

interface OpenRouterPricing {
  prompt: string;
  completion: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: OpenRouterPricing;
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";

export async function collectOpenRouter(): Promise<CollectorResult> {
  const key = process.env["OPENROUTER_API_KEY"] ?? "";
  if (!key) {
    console.warn("[openrouter] OPENROUTER_API_KEY not set — skipping");
    return { metrics: [], unmatched: [] };
  }

  let data: OpenRouterResponse;
  try {
    const resp = await fetch(OR_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) {
      console.warn(`[openrouter] HTTP ${resp.status} — skipping`);
      return { metrics: [], unmatched: [] };
    }
    data = (await resp.json()) as OpenRouterResponse;
  } catch (err) {
    console.warn(`[openrouter] fetch error: ${String(err)} — skipping`);
    return { metrics: [], unmatched: [] };
  }

  const metrics: NormalizedMetric[] = [];
  const unmatched: { externalId: string; name: string }[] = [];

  for (const model of data.data) {
    const localId = resolveModelId(model.id);
    if (!localId) {
      unmatched.push({ externalId: model.id, name: model.name });
      continue;
    }

    // pricing.prompt / .completion are cost per token as decimal strings
    const priceIn = parseFloat(model.pricing.prompt);
    const priceOut = parseFloat(model.pricing.completion);

    if (isFinite(priceIn) && priceIn > 0) {
      // Store as price per million tokens (consistent with artificialanalysis)
      metrics.push({
        model_id: localId,
        source: "openrouter",
        metric: "price_in",
        value: priceIn * 1_000_000,
        confidence: 0.9,
      });
    }
    if (isFinite(priceOut) && priceOut > 0) {
      metrics.push({
        model_id: localId,
        source: "openrouter",
        metric: "price_out",
        value: priceOut * 1_000_000,
        confidence: 0.9,
      });
    }
    if (model.context_length !== null && model.context_length > 0) {
      metrics.push({
        model_id: localId,
        source: "openrouter",
        metric: "context_window",
        value: model.context_length,
        confidence: 0.9,
      });
    }
  }

  return { metrics, unmatched };
}
