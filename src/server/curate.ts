import { canon } from "./collectors/normalize.js";
import type { ModelMetrics } from "./scoring/normalize.js";

// Curation collapses the raw IU catalog (which carries dated snapshot pins,
// case variants and residency variants of the same endpoint) down to the set of
// "current" models worth surfacing by default. The signal is leaderboard
// coverage: ArtificialAnalysis only publishes a quality index for models it
// still tracks, so "has a quality metric" is our proxy for "current LLM".
// Audio/other modalities have no leaderboard, so accessibility is the signal.

export interface CurateModelInput {
  id: string;
  modality: string;
}

export interface CurationResult {
  /** Metrics with quality/cost/speed propagated across canonical siblings. */
  metrics: ModelMetrics[];
  /** Representative model ids surfaced by the default "current only" view. */
  currentIds: Set<string>;
}

/** Residency variant a catalog id encodes via an `-eu` / `-us` token. EU and US
 *  variants of the same model are kept as distinct entries (GDPR routing). */
function residencyClass(id: string): "eu" | "us" | "default" {
  const s = id.toLowerCase();
  if (/(?:^|-)eu(?:$|-)/.test(s)) return "eu";
  if (/(?:^|-)us(?:$|-)/.test(s)) return "us";
  return "default";
}

const DATE_RE = /\d{4}-\d{2}-\d{2}|\d{8}|-20\d{2}\b/;

/** A dated snapshot pin like `gpt-4o-2024-08-06` — redundant when an undated
 *  alias of the same model exists. */
export function isDatedPin(id: string): boolean {
  return DATE_RE.test(id);
}

/**
 * Fills quality/cost/speed onto every catalog variant that shares a canonical
 * identity with a sibling that has the metric — so `claude-sonnet-4-5-eu`
 * inherits the leaderboard data matched against `claude-sonnet-4-5-20250929`.
 * Returns a new list including entries for previously metric-less models.
 */
export function propagateMetrics(
  models: CurateModelInput[],
  metrics: ModelMetrics[],
): ModelMetrics[] {
  const byId = new Map(metrics.map((m) => [m.model_id, m]));
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const k = canon(m.id);
    const arr = groups.get(k);
    if (arr) arr.push(m.id);
    else groups.set(k, [m.id]);
  }

  const out = new Map<string, ModelMetrics>(metrics.map((m) => [m.model_id, { ...m }]));
  for (const ids of groups.values()) {
    let quality: number | null = null;
    let coding: number | null = null;
    let cost: number | null = null;
    let speed: number | null = null;
    for (const id of ids) {
      const e = byId.get(id);
      if (e === undefined) continue;
      quality ??= e.quality;
      coding ??= e.coding;
      cost ??= e.cost;
      speed ??= e.speed;
    }
    if (quality === null && coding === null && cost === null && speed === null) continue;
    for (const id of ids) {
      let e = out.get(id);
      if (e === undefined) {
        e = { model_id: id, quality: null, coding: null, cost: null, speed: null };
        out.set(id, e);
      }
      e.quality ??= quality;
      e.coding ??= coding;
      e.cost ??= cost;
      e.speed ??= speed;
    }
  }
  return [...out.values()];
}

/** True if `a` is a better default representative for its group than `b`:
 *  prefer leaderboard-covered, then undated, then the shorter (cleaner) id. */
function isBetterRep(
  a: CurateModelInput,
  b: CurateModelInput,
  byId: Map<string, ModelMetrics>,
): boolean {
  const aq = byId.get(a.id)?.quality != null;
  const bq = byId.get(b.id)?.quality != null;
  if (aq !== bq) return aq;
  const ad = isDatedPin(a.id);
  const bd = isDatedPin(b.id);
  if (ad !== bd) return !ad;
  return a.id.length <= b.id.length;
}

/**
 * Propagates metrics, then collapses each (canonical id, residency) group to one
 * representative and marks it "current" when it carries a quality index (LLM) or
 * is reachable on the IU endpoint (audio/other). Pure — no DB or network.
 */
export function curate(
  models: CurateModelInput[],
  metrics: ModelMetrics[],
  isAccessible: (id: string) => boolean,
): CurationResult {
  const augmented = propagateMetrics(models, metrics);
  const byId = new Map(augmented.map((m) => [m.model_id, m]));

  const groups = new Map<string, CurateModelInput[]>();
  for (const m of models) {
    const key = `${canon(m.id)}|${residencyClass(m.id)}`;
    const arr = groups.get(key);
    if (arr) arr.push(m);
    else groups.set(key, [m]);
  }

  const currentIds = new Set<string>();
  for (const group of groups.values()) {
    const rep = group.reduce((best, cur) => (isBetterRep(best, cur, byId) ? best : cur));
    const isCurrent =
      rep.modality === "llm" ? byId.get(rep.id)?.quality != null : isAccessible(rep.id);
    if (isCurrent) currentIds.add(rep.id);
  }

  return { metrics: augmented, currentIds };
}
