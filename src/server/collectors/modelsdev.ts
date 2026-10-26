import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";

// models.dev is the list-price source: provider → models, USD per 1M tokens.
// https://models.dev/api.json — no auth. Resellers list the same model at wildly
// different prices, so a model's group (its canonical_model_id) takes the first-party
// provider's row when there is one, else the median across providers.
interface ModelsDevModel {
  id: string;
  name?: string;
  canonical_model_id?: string;
  cost?: { input?: number; output?: number; cache_read?: number } | null;
  limit?: { context?: number } | null;
}

type ModelsDevApi = Record<string, { models?: Record<string, ModelsDevModel> }>;

const MODELS_DEV_URL = "https://models.dev/api.json";
const FIRST_PARTY_CONFIDENCE = 0.95;
const MEDIAN_CONFIDENCE = 0.8;

interface Entry {
  provider: string;
  model: ModelsDevModel;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function pick(entries: Entry[], read: (m: ModelsDevModel) => number | undefined): number | null {
  return median(
    entries
      .map((e) => read(e.model))
      .filter((v): v is number => v !== undefined && isFinite(v) && v > 0),
  );
}

export async function collectModelsDev(resolve: IdResolver): Promise<CollectorResult> {
  let api: ModelsDevApi;
  try {
    const resp = await fetch(MODELS_DEV_URL);
    if (!resp.ok) {
      console.warn(`[modelsdev] HTTP ${resp.status} — skipping`);
      return { metrics: [], unmatched: [] };
    }
    api = (await resp.json()) as ModelsDevApi;
  } catch (err) {
    console.warn(`[modelsdev] fetch error: ${String(err)} — skipping`);
    return { metrics: [], unmatched: [] };
  }

  const groups = new Map<string, Entry[]>();
  for (const [provider, body] of Object.entries(api)) {
    for (const model of Object.values(body.models ?? {})) {
      const key = model.canonical_model_id ?? `${provider}/${model.id}`;
      const group = groups.get(key);
      if (group) group.push({ provider, model });
      else groups.set(key, [{ provider, model }]);
    }
  }

  const metrics: NormalizedMetric[] = [];
  const unmatched: { externalId: string; name: string }[] = [];
  let unmatchedResellerOnly = 0;
  const seen = new Set<string>();

  for (const [key, entries] of groups) {
    const vendor = key.includes("/") ? key.split("/")[0] : undefined;
    const firstParty = entries.filter((e) => e.provider === vendor);
    const source = firstParty.length > 0 ? firstParty : entries;
    const confidence = firstParty.length > 0 ? FIRST_PARTY_CONFIDENCE : MEDIAN_CONFIDENCE;

    const localId =
      resolve(key) ?? source.map((e) => resolve(e.model.id)).find((id) => id !== null) ?? null;
    if (!localId) {
      if (firstParty.length > 0) {
        unmatched.push({ externalId: key, name: firstParty[0]?.model.name ?? key });
      } else {
        unmatchedResellerOnly++;
      }
      continue;
    }
    // Two groups can resolve to one local id (a dated snapshot beside its alias):
    // the first one in API order wins so a model never carries two price rows.
    if (seen.has(localId)) continue;
    seen.add(localId);

    const rows: [string, number | null][] = [
      ["price_in", pick(source, (m) => m.cost?.input)],
      ["price_out", pick(source, (m) => m.cost?.output)],
      ["price_cache_read", pick(source, (m) => m.cost?.cache_read)],
      ["context_window", pick(source, (m) => m.limit?.context)],
    ];
    for (const [metric, value] of rows) {
      if (value === null) continue;
      metrics.push({ model_id: localId, source: "modelsdev", metric, value, confidence });
    }
  }

  console.log(
    `[modelsdev] ${seen.size} catalog models priced; ${unmatched.length} first-party ids unmatched, ` +
      `${unmatchedResellerOnly} reseller-only groups ignored`,
  );
  return { metrics, unmatched };
}
