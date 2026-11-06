import { canon, compareVersions, createIdResolver } from "../collectors/normalize.js";
import { SNAPSHOT_PINS } from "../collectors/snapshot-pins.js";
import type { AaVariant, Model } from "../../db/schema.js";
import type { AgwRoute } from "./agw-routes.js";
import type {
  EfficiencyResponse,
  EfficiencyRoute,
  EfficiencyVariant,
  UnscoredModel,
} from "./types.js";
import { accessOf, computeSuperseded, estimateTask, routeVariant, versionKey } from "./variants.js";

export interface BuildInput {
  variants: readonly AaVariant[];
  models: readonly Model[];
  /** model_id -> `accessible` of its latest probe. */
  probes: ReadonlyMap<string, boolean>;
  routes: readonly AgwRoute[];
  routesError: string | null;
  now?: Date;
}

const SOURCE = {
  name: "Artificial Analysis",
  url: "https://artificialanalysis.ai",
  attribution: "Source: Artificial Analysis (artificialanalysis.ai)",
} as const;

const PIN_LINEAGES = new Map(Object.entries(SNAPSHOT_PINS).map(([id, slug]) => [slug, id]));

/** Shortest id first, so a residency twin (`-eu`) never wins a canonical-form collision. */
function byLengthThenAlpha(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/** Lineage -> IU catalog id, pins first, then the shared leaderboard-id resolver. */
function createLineageResolver(llmIds: readonly string[]): (lineage: string) => string | null {
  const resolve = createIdResolver([...llmIds].toSorted(byLengthThenAlpha));
  return (lineage) => PIN_LINEAGES.get(lineage) ?? resolve(lineage);
}

/** Pure assembly of the /api/efficiency payload from already-loaded rows. */
export function buildEfficiency(input: BuildInput): EfficiencyResponse {
  const { variants, models, probes, routes, routesError } = input;
  const now = input.now ?? new Date();
  const scoredRows = variants.filter((v) => v.intelligence !== null);

  const llm = models.filter((m) => m.modality === "llm");
  const byId = new Map(llm.map((m) => [m.id, m]));
  const resolveIu = createLineageResolver(llm.map((m) => m.id));

  const newestByLineage = new Map<string, { creator: string; releaseDate: string | null }>();
  // Over every row, scored or not: a successor AA has not scored yet still supersedes.
  for (const v of variants) {
    const seen = newestByLineage.get(v.lineage);
    if (!seen || (v.release_date ?? "") > (seen.releaseDate ?? "")) {
      newestByLineage.set(v.lineage, { creator: v.creator, releaseDate: v.release_date });
    }
  }
  const superseded = computeSuperseded(
    [...newestByLineage].map(([lineage, info]) => ({ lineage, ...info })),
    now,
  );

  const out: EfficiencyVariant[] = scoredRows.map((v) => {
    const iuId = resolveIu(v.lineage);
    const iuModel = iuId ? byId.get(iuId) : undefined;
    const sup = superseded.get(v.lineage) ?? { superseded: false, supersededBy: null };
    return {
      slug: v.slug,
      name: v.name,
      lineage: v.lineage,
      effort: v.effort,
      creator: v.creator,
      releaseDate: v.release_date,
      intelligence: v.intelligence!,
      costPerTask: v.cost_per_task,
      priceIn: v.price_in,
      priceOut: v.price_out,
      priceCacheRead: v.price_cache_read,
      ...estimateTask({ costPerTask: v.cost_per_task, priceOut: v.price_out, tps: v.tps }),
      e2eSec: v.e2e_sec,
      tps: v.tps,
      ttfatSec: v.ttfat_sec,
      superseded: sup.superseded,
      supersededBy: sup.supersededBy,
      iu: {
        id: iuModel?.id ?? null,
        listed: iuModel?.iu_listed ?? false,
        accessible: iuModel ? (probes.get(iuModel.id) ?? false) : false,
        legs: iuModel?.legs ? iuModel.legs.split(",") : [],
      },
    };
  });

  const scoredSlugs = new Set(scoredRows.map((v) => v.slug));
  const outRoutes: EfficiencyRoute[] = routes.map((r) => ({
    route: r.route,
    wire: r.wire,
    model: r.model,
    effort: r.effort,
    access: accessOf(r.model),
    ...routeVariant({ model: r.model, effort: r.effort, scoredSlugs }),
  }));

  const capturedAt = variants.reduce<string | null>(
    (max, v) => (max === null || v.updated_at > max ? v.updated_at : max),
    null,
  );

  return {
    capturedAt,
    generatedAt: now.toISOString(),
    source: SOURCE,
    variants: out,
    routes: outRoutes,
    routesError,
    unscored: unscoredModels({ llm, probes, scoredIuIds: new Set(out.flatMap((v) => (v.iu.id ? [v.iu.id] : []))) }),
  };
}

/**
 * IU-listed llm models that answered the latest probe but have no scored AA row. Residency
 * twins of a scored id collapse onto it (canonical form), and an id whose provider + family
 * has a higher version in the catalog is dropped, same rule as the AA superseded logic.
 */
function unscoredModels(input: {
  llm: readonly Model[];
  probes: ReadonlyMap<string, boolean>;
  scoredIuIds: ReadonlySet<string>;
}): UnscoredModel[] {
  const { llm, probes, scoredIuIds } = input;
  const scoredCanons = new Set([...scoredIuIds].map(canon));
  for (const [id, slug] of Object.entries(SNAPSHOT_PINS)) scoredCanons.add(canon(id)).add(canon(slug));

  const listed = llm.filter((m) => m.iu_listed && probes.get(m.id) === true);
  const highest = new Map<string, string>();
  for (const m of llm.filter((x) => x.iu_listed)) {
    const { family, version } = versionKey(m.id);
    if (version === null) continue;
    const key = `${m.provider}\u0000${family}`;
    const seen = highest.get(key);
    if (seen === undefined || compareVersions(version, seen) > 0) highest.set(key, version);
  }

  const seenCanons = new Set<string>();
  const result: UnscoredModel[] = [];
  for (const m of [...listed].toSorted((a, b) => byLengthThenAlpha(a.id, b.id))) {
    const c = canon(m.id);
    if (scoredCanons.has(c) || seenCanons.has(c)) continue;
    const { family, version } = versionKey(m.id);
    const top = highest.get(`${m.provider}\u0000${family}`);
    if (version !== null && top !== undefined && compareVersions(version, top) < 0) continue;
    seenCanons.add(c);
    result.push({ id: m.id, legs: m.legs ? m.legs.split(",") : [], accessible: true });
  }
  return result.toSorted((a, b) => a.id.localeCompare(b.id));
}
