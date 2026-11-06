// Wire contract of GET /api/efficiency. Argo relays it verbatim; change it only together
// with Argo. Source data: ArtificialAnalysis free API (attribution required).

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "default";

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
