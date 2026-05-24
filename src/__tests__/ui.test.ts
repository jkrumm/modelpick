import { describe, it, expect } from "vitest";
import { scoreModels } from "../server/scoring/score";
import type { ModelMetrics } from "../server/scoring/normalize";
import type { ProbeInfo } from "../routes/-server-fns";

// ── Helpers replicated from index.tsx (pure functions) ────────────────────────

type RecommendationCategory = "fast" | "coding" | "orchestrator" | "tts" | "stt";

const CATEGORY_MODALITY: Record<RecommendationCategory, "llm" | "tts" | "stt"> = {
  fast: "llm",
  coding: "llm",
  orchestrator: "llm",
  tts: "tts",
  stt: "stt",
};

function getTopModels(
  modelMetrics: ModelMetrics[],
  probes: Record<string, ProbeInfo>,
  modelMap: Map<string, { modality: string }>,
  category: RecommendationCategory,
  weights: { quality: number; cost: number; speed: number },
  iuOnly: boolean,
  residencyFilter: "all" | "eu" | "us",
) {
  const targetModality = CATEGORY_MODALITY[category];
  const filtered = modelMetrics.filter((mm) => {
    const model = modelMap.get(mm.model_id);
    if (model?.modality !== targetModality) return false;
    if (iuOnly) {
      const p = probes[mm.model_id];
      if (p === undefined || !p.accessible) return false;
    }
    if (residencyFilter !== "all") {
      const p = probes[mm.model_id];
      if (p?.residency !== residencyFilter) return false;
    }
    return true;
  });
  return scoreModels(filtered, weights);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const metrics: ModelMetrics[] = [
  { model_id: "model-a", quality: 0.9, cost: 0.2, speed: 0.5 },
  { model_id: "model-b", quality: 0.5, cost: 0.9, speed: 0.8 },
  { model_id: "model-c", quality: 0.7, cost: 0.6, speed: 0.6 },
  { model_id: "tts-1", quality: 0.8, cost: 0.5, speed: 0.7 },
];

const probes: Record<string, ProbeInfo> = {
  "model-a": { accessible: true, latency_ms: 200, residency: "eu" },
  "model-b": { accessible: false, latency_ms: 100, residency: "us" },
  "model-c": { accessible: true, latency_ms: 150, residency: "us" },
  "tts-1": { accessible: true, latency_ms: 50, residency: "eu" },
};

const modelMap = new Map<string, { modality: string }>([
  ["model-a", { modality: "llm" }],
  ["model-b", { modality: "llm" }],
  ["model-c", { modality: "llm" }],
  ["tts-1", { modality: "tts" }],
]);

const defaultWeights = { quality: 0.5, cost: 0.3, speed: 0.2 };

describe("getTopModels", () => {
  it("returns only llm models for coding category", () => {
    const top = getTopModels(metrics, probes, modelMap, "coding", defaultWeights, false, "all");
    const ids = top.map((m) => m.model_id);
    expect(ids).not.toContain("tts-1");
    expect(ids.length).toBe(3);
  });

  it("returns only tts models for tts category", () => {
    const top = getTopModels(metrics, probes, modelMap, "tts", defaultWeights, false, "all");
    expect(top.map((m) => m.model_id)).toEqual(["tts-1"]);
  });

  it("excludes inaccessible models when iuOnly=true", () => {
    const top = getTopModels(metrics, probes, modelMap, "fast", defaultWeights, true, "all");
    const ids = top.map((m) => m.model_id);
    expect(ids).not.toContain("model-b"); // not accessible
    expect(ids).toContain("model-a");
    expect(ids).toContain("model-c");
  });

  it("filters by EU residency", () => {
    const top = getTopModels(metrics, probes, modelMap, "coding", defaultWeights, false, "eu");
    const ids = top.map((m) => m.model_id);
    expect(ids).toContain("model-a");
    expect(ids).not.toContain("model-b");
    expect(ids).not.toContain("model-c");
  });

  it("filters by US residency", () => {
    const top = getTopModels(metrics, probes, modelMap, "coding", defaultWeights, false, "us");
    const ids = top.map((m) => m.model_id);
    expect(ids).toContain("model-b");
    expect(ids).toContain("model-c");
    expect(ids).not.toContain("model-a");
  });

  it("returns empty when iuOnly=true and residency=eu filters out all", () => {
    // model-a is EU+accessible, model-c is US+accessible, model-b is US+inaccessible
    const top = getTopModels(metrics, probes, modelMap, "fast", defaultWeights, true, "us");
    const ids = top.map((m) => m.model_id);
    expect(ids).toContain("model-c");
    expect(ids).not.toContain("model-b"); // not accessible
    expect(ids).not.toContain("model-a"); // EU, not US
  });

  it("re-ranks with speed-heavy weights", () => {
    const speedWeights = { quality: 0.1, cost: 0.1, speed: 0.8 };
    const top = getTopModels(metrics, probes, modelMap, "fast", speedWeights, false, "all");
    // model-b has speed=0.8, should win
    expect(top[0]?.model_id).toBe("model-b");
  });

  it("re-ranks with quality-heavy weights", () => {
    const qualityWeights = { quality: 0.9, cost: 0.05, speed: 0.05 };
    const top = getTopModels(metrics, probes, modelMap, "orchestrator", qualityWeights, false, "all");
    // model-a has quality=0.9, should win
    expect(top[0]?.model_id).toBe("model-a");
  });

  it("returns results sorted by score descending", () => {
    const top = getTopModels(metrics, probes, modelMap, "fast", defaultWeights, false, "all");
    for (let i = 1; i < top.length; i++) {
      const prev = top[i - 1];
      const curr = top[i];
      if (prev !== undefined && curr !== undefined) {
        expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      }
    }
  });
});

// ── Sort / filter table rows ──────────────────────────────────────────────────

interface TableRow {
  model_id: string;
  display_name: string;
  provider: string;
  modality: "llm" | "tts" | "stt";
  quality: number | null;
  cost: number | null;
  speed: number | null;
  score: number;
  accessible: boolean;
  residency: "eu" | "us" | "unknown";
  latency_ms: number | null;
}

type SortField = "display_name" | "provider" | "quality" | "cost" | "speed" | "score";
type SortDir = "asc" | "desc";

function sortRows(rows: TableRow[], field: SortField, dir: SortDir): TableRow[] {
  return rows.toSorted((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

const tableRows: TableRow[] = [
  { model_id: "a", display_name: "Alpha", provider: "openai", modality: "llm", quality: 0.9, cost: 0.5, speed: 0.3, score: 0.7, accessible: true, residency: "eu", latency_ms: 200 },
  { model_id: "b", display_name: "Beta", provider: "anthropic", modality: "llm", quality: null, cost: 0.8, speed: 0.9, score: 0.4, accessible: false, residency: "us", latency_ms: 100 },
  { model_id: "c", display_name: "Gamma", provider: "google", modality: "tts", quality: 0.6, cost: null, speed: 0.7, score: 0.55, accessible: true, residency: "us", latency_ms: null },
];

describe("sortRows", () => {
  it("sorts by score descending", () => {
    const sorted = sortRows(tableRows, "score", "desc");
    expect(sorted.map((r) => r.model_id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by score ascending", () => {
    const sorted = sortRows(tableRows, "score", "asc");
    expect(sorted.map((r) => r.model_id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by display_name alphabetically", () => {
    const sorted = sortRows(tableRows, "display_name", "asc");
    expect(sorted.map((r) => r.display_name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("puts null values last regardless of sort direction", () => {
    const ascSorted = sortRows(tableRows, "quality", "asc");
    expect(ascSorted[ascSorted.length - 1]?.model_id).toBe("b"); // quality=null last

    const descSorted = sortRows(tableRows, "quality", "desc");
    expect(descSorted[descSorted.length - 1]?.model_id).toBe("b"); // null last
  });

  it("sorts cost desc — null comes last", () => {
    const sorted = sortRows(tableRows, "cost", "desc");
    expect(sorted[sorted.length - 1]?.model_id).toBe("c"); // cost=null last
  });
});
