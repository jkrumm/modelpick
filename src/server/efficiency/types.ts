// Wire contract of GET /api/efficiency. Argo relays it verbatim and reads `coding` (added with
// issue 2085; shape and formula below and in docs/pipelines.md, which the Argo Issue builds on),
// so a change to a field here lands in the Argo repo too.
// Source data: ArtificialAnalysis free API (attribution required) and Epoch AI benchmark data
// (CC-BY 4.0, https://epoch.ai/data/benchmark_data.zip) for `coding`.

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "default";

/** One coding benchmark of one variant, from Epoch AI. Scores are on the benchmark's own scale. */
export interface CodingComponent {
  /** cursorbench | swe_bench_verified | terminalbench | frontierswe | frontiercode | scicode | aider_polyglot | webdev_arena */
  benchmark: string;
  score: number;
  /** USD per task; CursorBench only, else null. */
  costPerTask: number | null;
  /** Tokens per task; CursorBench only, else null. */
  tokensPerTask: number | null;
}

/**
 * Coding evidence for one variant. `components` lists every benchmark Epoch measured for this
 * exact (model, effort): an Epoch tier `<base>_<effort>` is the AA variant `<base>-<effort>`,
 * and Epoch `max` is the bare slug `<base>` (AA's bare Claude slugs are Max rows).
 *
 * `score` (0-100) is the mean, over the variant's benchmarks, of its percentile rank among all
 * variants in this response that have that benchmark. Percentile is mid-rank:
 * (below + equal / 2) / n * 100 with ties counting the variant itself; a benchmark that only one
 * variant has contributes nothing. `score` is null when fewer than 2 benchmarks contribute (the
 * components are still listed). Ranks move as variants or benchmarks are added, so compare
 * scores within one response, never across time.
 */
export interface EfficiencyCoding {
  score: number | null;
  components: CodingComponent[];
}

export interface EfficiencyVariant {
  slug: string;
  name: string;
  lineage: string;
  effort: Effort;
  creator: string;
  releaseDate: string | null;
  intelligence: number;
  costPerTask: number | null;
  priceIn: number | null;
  priceOut: number | null;
  priceCacheRead: number | null;
  /** Estimate: costPerTask / priceOut, in output-equivalent tokens. */
  tokensPerTaskEst: number | null;
  /** Estimate: tokensPerTaskEst / tps. */
  timePerTaskEstSec: number | null;
  e2eSec: number | null;
  tps: number | null;
  ttfatSec: number | null;
  /** Null when Epoch has no coding benchmark for this exact (model, effort). */
  coding: EfficiencyCoding | null;
  superseded: boolean;
  supersededBy: string | null;
  iu: { id: string | null; listed: boolean; accessible: boolean; legs: string[] };
}

export interface EfficiencyRoute {
  route: string;
  wire: string;
  model: string;
  effort: string | null;
  access: "subscription" | "metered";
  variantSlug: string | null;
  reason: string | null;
}

export interface EfficiencyResponse {
  capturedAt: string | null;
  generatedAt: string;
  source: {
    name: "Artificial Analysis";
    url: "https://artificialanalysis.ai";
    attribution: "Source: Artificial Analysis (artificialanalysis.ai)";
  };
  /** Only rows with a non-null intelligence index. */
  variants: EfficiencyVariant[];
  /** LLM routes only: audio.*, non-LLM image.* and decide are dropped. */
  routes: EfficiencyRoute[];
  /** agw unavailable: routes is empty and this is set; the response is still 200. */
  routesError: string | null;
}
