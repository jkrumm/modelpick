import type { MetricSource } from "../../db/schema.js";
import { LOCAL_MODEL_IDS } from "../../db/model-ids.js";

export interface NormalizedMetric {
  model_id: string;
  source: MetricSource;
  metric: string;
  value: number;
  confidence: number;
}

export interface CollectorResult {
  metrics: NormalizedMetric[];
  unmatched: { externalId: string; name: string }[];
}

const KNOWN_IDS = new Set(LOCAL_MODEL_IDS);

function norm(s: string): string {
  return s.toLowerCase().replace(/[._/\s]+/g, "-").replace(/-+/g, "-");
}

// Maps an external model ID to a local model ID.
// Strategy: exact → strip provider prefix → fuzzy lowercase
export function resolveModelId(externalId: string): string | null {
  if (KNOWN_IDS.has(externalId)) return externalId;

  // Strip provider prefix: "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
  if (externalId.includes("/")) {
    const withoutPrefix = externalId.split("/").slice(1).join("/");
    if (KNOWN_IDS.has(withoutPrefix)) return withoutPrefix;
  }

  // Fuzzy: normalize separators and compare
  const normExternal = norm(externalId);
  for (const localId of KNOWN_IDS) {
    if (norm(localId) === normExternal) return localId;
  }

  return null;
}
