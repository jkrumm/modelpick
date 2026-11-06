import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectArtificialAnalysis, toVariantRows } from "../server/collectors/artificialanalysis.js";
import { loadAgwRoutes, parseAgwRoutes, resetAgwRoutesCache } from "../server/efficiency/agw-routes.js";
import { buildEfficiency } from "../server/efficiency/build.js";
import {
  accessOf,
  computeSuperseded,
  effortFromName,
  estimateTask,
  parseVariant,
  resolveEfforts,
  routeVariant,
} from "../server/efficiency/variants.js";
import type { AaVariant, Model } from "../db/schema.js";

// Synthetic fixture: real slugs, names and dates, invented measurements. Never paste AA API rows here (fixtures/aa/README.md).
const AA = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../fixtures/aa/models.json"), "utf8"),
) as Parameters<typeof toVariantRows>[0];

const NOW = new Date("2026-11-06T12:00:00Z");
const rows = toVariantRows(AA);
const stamp = { first_seen_at: "2026-11-06 06:00:00", updated_at: "2026-11-06 06:00:00" };
const variants: AaVariant[] = rows.map((r) => ({ ...r, ...stamp }));

function lineageInfos() {
  const byLineage = new Map<string, { lineage: string; creator: string; releaseDate: string | null }>();
  for (const v of variants) {
    const seen = byLineage.get(v.lineage);
    if (!seen || (v.release_date ?? "") > (seen.releaseDate ?? "")) {
      byLineage.set(v.lineage, { lineage: v.lineage, creator: v.creator, releaseDate: v.release_date });
    }
  }
  return [...byLineage.values()];
}

describe("parseVariant / resolveEfforts", () => {
  it("splits the effort suffix off the lineage", () => {
    expect(parseVariant("gpt-6-1-terra-medium")).toEqual({ lineage: "gpt-6-1-terra", effort: "medium" });
    expect(parseVariant("gpt-6-1-terra-non-reasoning")).toEqual({ lineage: "gpt-6-1-terra", effort: "none" });
    expect(parseVariant("deepseek-v4-1-flash-1017-high")).toEqual({
      lineage: "deepseek-v4-1-flash-1017",
      effort: "high",
    });
    expect(parseVariant("claude-opus-5-5-xhigh").effort).toBe("xhigh");
    expect(parseVariant("gpt-6-1-terra")).toEqual({ lineage: "gpt-6-1-terra", effort: null });
  });

  it("names a bare slug max when siblings exist, default when alone", () => {
    const efforts = resolveEfforts(
      ["a", "a-low", "b", "c-non-reasoning", "c"].map((slug) => ({ slug })),
    );
    expect(efforts.get("a")).toBe("max");
    expect(efforts.get("a-low")).toBe("low");
    expect(efforts.get("b")).toBe("default");
    expect(efforts.get("c")).toBe("max");
    expect(efforts.get("c-non-reasoning")).toBe("none");
  });

  it("takes a bare slug's effort from the parenthetical in AA's name", () => {
    expect(effortFromName("Gemini 3.8 Flash (High)")).toBe("high");
    expect(effortFromName("Claude Opus 5.5 (Max, Default Fallback)")).toBe("max");
    expect(effortFromName("Claude Sonnet 4.6 (Non-reasoning, High)")).toBe("none");
    expect(effortFromName("GPT-6.1 Terra (XHigh)")).toBe("xhigh");
    expect(effortFromName("GLM-4.5 (Reasoning)")).toBeNull();
    expect(effortFromName("Grok 2 (Dec '24)")).toBeNull();
    expect(effortFromName("Plain Name")).toBeNull();
    const efforts = resolveEfforts([
      { slug: "gemini-3-8-flash", name: "Gemini 3.8 Flash (High)" },
      { slug: "gemini-3-8-flash-high", name: "Gemini 3.8 Flash (High)" },
      { slug: "gemini-3-8-flash-low", name: "Gemini 3.8 Flash (Low)" },
      { slug: "x", name: "X (Reasoning)" },
      { slug: "x-low", name: "X (Low)" },
    ]);
    expect(efforts.get("gemini-3-8-flash")).toBe("high");
    expect(efforts.get("x")).toBe("max");
  });

  it("derives the fixture rows", () => {
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get("gpt-6-1-terra")?.effort).toBe("max");
    expect(bySlug.get("gemini-3-8-flash")?.effort).toBe("high");
    expect(bySlug.get("gemini-4-carbon")?.effort).toBe("high");
    expect(bySlug.get("gpt-6-1-terra-medium")).toMatchObject({ effort: "medium", lineage: "gpt-6-1-terra" });
    expect(bySlug.get("claude-opus-5")?.effort).toBe("max");
    expect(bySlug.get("gpt-3-5-turbo-0613")?.effort).toBe("default");
  });
});

describe("estimateTask", () => {
  it("derives output-equivalent tokens and time", () => {
    expect(estimateTask({ costPerTask: 0.5, priceOut: 5, tps: 100 })).toEqual({
      tokensPerTaskEst: 100_000,
      timePerTaskEstSec: 1000,
    });
  });
  it("is null when the divisor is missing or zero", () => {
    expect(estimateTask({ costPerTask: 0.5, priceOut: 0, tps: 100 }).tokensPerTaskEst).toBeNull();
    expect(estimateTask({ costPerTask: 0.5, priceOut: null, tps: 100 }).tokensPerTaskEst).toBeNull();
    expect(estimateTask({ costPerTask: null, priceOut: 5, tps: 100 }).tokensPerTaskEst).toBeNull();
    expect(estimateTask({ costPerTask: 0.5, priceOut: 5, tps: null })).toEqual({
      tokensPerTaskEst: 100_000,
      timePerTaskEstSec: null,
    });
  });
});

describe("computeSuperseded on real lineages", () => {
  const sup = computeSuperseded(lineageInfos(), NOW);

  it.each([
    ["gpt-5-6-terra", "gpt-6-1-terra"],
    ["gpt-6-sol", "gpt-6-1-sol"],
    ["gpt-5-6-luna", "gpt-6-luna"],
    ["claude-opus-5", "claude-opus-5-5"],
    ["claude-sonnet-5", "claude-sonnet-5-5"],
    ["claude-fable-5", "claude-fable-5-1"],
    ["deepseek-v4-flash", "deepseek-v4-1-flash-1017"],
  ])("%s is superseded by %s", (lineage, by) => {
    expect(sup.get(lineage)).toEqual({ superseded: true, supersededBy: by });
  });

  it.each(["gpt-6-luna", "gpt-6-astra", "gemini-3-8-flash", "gemini-4-carbon", "gpt-6-1-terra"])(
    "%s stays current",
    (lineage) => {
      expect(sup.get(lineage)?.superseded).toBe(false);
    },
  );

  it("drops lineages older than 12 months without a successor", () => {
    expect(sup.get("claude-4-5-haiku-reasoning")?.superseded).toBe(true);
    expect(sup.get("gpt-3-5-turbo-0613")?.superseded).toBe(true);
    expect(sup.get("claude-35-sonnet")).toEqual({ superseded: true, supersededBy: null });
  });
});

describe("computeSuperseded edge cases", () => {
  it("keeps both when version and date tie", () => {
    const sup = computeSuperseded(
      [
        { lineage: "acme-1-flash-0101", creator: "Acme", releaseDate: "2026-10-01" },
        { lineage: "acme-1-flash-0202", creator: "Acme", releaseDate: "2026-10-01" },
      ],
      NOW,
    );
    expect([...sup.values()].some((s) => s.superseded)).toBe(false);
  });
  it("lets the newest snapshot win at the same version", () => {
    const sup = computeSuperseded(
      [
        { lineage: "acme-v1-flash-0101", creator: "Acme", releaseDate: "2026-09-01" },
        { lineage: "acme-v1-flash-0202", creator: "Acme", releaseDate: "2026-10-01" },
      ],
      NOW,
    );
    expect(sup.get("acme-v1-flash-0101")).toEqual({ superseded: true, supersededBy: "acme-v1-flash-0202" });
  });
  it("never groups across creators", () => {
    const sup = computeSuperseded(
      [
        { lineage: "x-1-flash", creator: "A", releaseDate: "2026-10-01" },
        { lineage: "x-2-flash", creator: "B", releaseDate: "2026-10-01" },
      ],
      NOW,
    );
    expect(sup.get("x-1-flash")?.superseded).toBe(false);
  });
});

describe("routeVariant / accessOf", () => {
  const scoredRows = variants
    .filter((v) => v.intelligence !== null)
    .map((v) => ({ slug: v.slug, lineage: v.lineage, effort: v.effort }));
  const slugOf = (model: string, effort: string | null) =>
    routeVariant({ model, effort, scoredRows }).variantSlug;

  it("maps (model, effort) to the AA slug", () => {
    expect(slugOf("claude-haiku-5-5", "high")).toBe("claude-haiku-5-5-high");
    expect(slugOf("gpt-6.1-terra", "medium")).toBe("gpt-6-1-terra-medium");
    expect(slugOf("gpt-6.1-terra", "none")).toBe("gpt-6-1-terra-non-reasoning");
    expect(slugOf("gpt-6.1-terra", null)).toBe("gpt-6-1-terra");
    expect(slugOf("gpt-6.1-terra", "max")).toBe("gpt-6-1-terra");
    expect(slugOf("deepseek-v4.1-flash", "high")).toBe("deepseek-v4-1-flash-1017-high");
  });

  it("resolves a bare slug that carries a non-max effort (Gemini's bare slug is high)", () => {
    expect(slugOf("gemini-3.8-flash", "high")).toBe("gemini-3-8-flash");
    expect(slugOf("gemini-3.8-flash", "medium")).toBe("gemini-3-8-flash-medium");
    expect(slugOf("gemini-3.8-flash", null)).toBe("gemini-3-8-flash");
    expect(routeVariant({ model: "gemini-3.8-flash", effort: "max", scoredRows })).toEqual({
      variantSlug: null,
      reason: "no AA row at effort max",
    });
  });

  it("never falls back to another effort", () => {
    expect(routeVariant({ model: "claude-haiku-5-5", effort: "none", scoredRows })).toEqual({
      variantSlug: null,
      reason: "no AA row at effort none",
    });
  });
  it("sorts access by vendor prefix", () => {
    expect(accessOf("claude-sonnet-5-5")).toBe("subscription");
    expect(accessOf("gpt-6.1-terra")).toBe("metered");
  });
});

describe("agw routes", () => {
  const raw = `{"routes":{
    "cheap.title":{"wire":"anthropic","model":"claude-haiku-5-5","effort":"none"},
    "audio.tts.gemini-flash":{"wire":"iu-gemini","model":"gemini-3.8-flash-tts","rate":{}},
    "audio.tts.prep":{"wire":"anthropic","model":"claude-haiku-5-5","effort":"none"},
    "image.upscale":{"wire":"iu-openai","model":"nightmareai/real-esrgan","price":{}},
    "decide":{"wire":"iu-decision","model":"decision-1"}},
    "table":"a\tb\nc"}`;

  beforeEach(() => resetAgwRoutesCache());

  it("keeps LLM routes only and survives raw control chars", () => {
    expect(parseAgwRoutes(raw).map((r) => r.route)).toEqual(["cheap.title", "audio.tts.prep"]);
  });

  it("serves the stale copy when agw later fails", async () => {
    expect((await loadAgwRoutes(async () => raw)).routes).toHaveLength(2);
    expect((await loadAgwRoutes(async () => raw)).error).toBeNull();
  });

  it("reports an error with empty routes when agw never answered", async () => {
    const res = await loadAgwRoutes(async () => {
      throw new Error("ENOENT");
    });
    expect(res.routes).toEqual([]);
    expect(res.error).toContain("ENOENT");
  });
});

describe("buildEfficiency", () => {
  const model = (id: string, extra: Partial<Model> = {}): Model => ({
    id,
    provider: "x",
    family: null,
    modality: "llm",
    display_name: id,
    context_window: null,
    iu_listed: true,
    transport: "iu",
    owned_by: null,
    legs: "openai",
    created_at: "2026-01-01",
    ...extra,
  });
  const models = [
    model("gpt-6.1-terra", { provider: "openai" }),
    model("gpt-6-newthing", { provider: "openai", legs: "openai,anthropic" }),
    model("claude-haiku-5-5", { provider: "anthropic", legs: "openai,anthropic" }),
    model("claude-haiku-5-5-eu", { provider: "anthropic" }),
    model("deepseek-v4.1-flash", { provider: "deepseek" }),
    model("gpt-5.6-terra", { provider: "openai" }),
    model("DeepSeek-V4-Flash", { provider: "deepseek" }),
    model("deepseek-v4.1-flash-1017", { provider: "deepseek" }),
    model("gpt-6.1-tts", { modality: "tts", provider: "openai" }),
  ];
  const probes = new Map(models.map((m) => [m.id, true]));
  const res = buildEfficiency({
    variants,
    models,
    probes,
    routes: [
      { route: "a", wire: "anthropic", model: "claude-haiku-5-5", effort: "high" },
      { route: "b", wire: "iu-openai", model: "gpt-6.1-terra", effort: "none" },
      { route: "c", wire: "anthropic", model: "claude-haiku-5-5", effort: "none" },
    ],
    routesError: null,
    now: NOW,
  });

  it("returns scored variants only, with estimates and the contract's fixed source", () => {
    expect(res.variants.length).toBe(variants.filter((v) => v.intelligence !== null).length);
    expect(res.source.attribution).toBe("Source: Artificial Analysis (artificialanalysis.ai)");
    const medium = res.variants.find((v) => v.slug === "gpt-6-1-terra-medium")!;
    expect(medium).toMatchObject({ effort: "medium", lineage: "gpt-6-1-terra", superseded: false });
    expect(medium.tokensPerTaskEst).toBeCloseTo((medium.costPerTask! / medium.priceOut!) * 1e6);
    expect(medium.iu).toEqual({ id: "gpt-6.1-terra", listed: true, accessible: true, legs: ["openai"] });
  });

  it("maps the snapshot pin and residency twins onto one catalog id", () => {
    const flash = res.variants.find((v) => v.slug === "deepseek-v4-1-flash-1017-high")!;
    expect(flash.iu.id).toBe("deepseek-v4.1-flash");
    expect(res.variants.find((v) => v.slug === "claude-haiku-5-5-high")!.iu.id).toBe("claude-haiku-5-5");
  });

  it("flags the missing effort on a route without falling back", () => {
    expect(res.routes.map((r) => [r.route, r.variantSlug, r.access])).toEqual([
      ["a", "claude-haiku-5-5-high", "subscription"],
      ["b", "gpt-6-1-terra-non-reasoning", "metered"],
      ["c", null, "subscription"],
    ]);
    expect(res.routes[2]?.reason).toBe("no AA row at effort none");
  });

  it("lists accessible unscored llm ids, minus superseded versions and residency twins", () => {
    expect(res.unscored.map((u) => u.id)).toEqual(["gpt-6-newthing"]);
  });

  it("stamps capturedAt from the newest row", () => {
    expect(res.capturedAt).toBe("2026-11-06 06:00:00");
  });
});

describe("collectArtificialAnalysis variants", () => {
  it("returns every slug of the fetch beside the unchanged metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: AA.slice(0, 5), pagination: { has_more: false } }) })),
    );
    process.env["ARTIFICIALANALYSIS_API_KEY"] = "test-key";
    const res = await collectArtificialAnalysis(() => null);
    vi.unstubAllGlobals();
    expect(res.aaVariants).toHaveLength(5);
    expect(res.metrics).toEqual([]);
  });
});
