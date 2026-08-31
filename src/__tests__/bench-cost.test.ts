import { describe, it, expect } from "vitest";
import {
  CLAUDE_LIST_RATES,
  computeCost,
  isClaudeListId,
  normaliseModelId,
  priceRun,
  priceRunResult,
  resolveRates,
  type Rates,
} from "../server/bench/cost.js";
import { composite, perModel, perTask } from "../server/bench/score.js";
import { renderReport, toJson } from "../server/bench/report.js";
import { harnessErrorMetrics } from "../server/bench/metrics.js";
import type { BenchRunResult, CostBasis, RunMetrics } from "../server/bench/types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Solved by `bun run pick` from the gateway's own `usage.cost`, as stored in
 *  `pick_probe`. The probe never solves a cache-write rate. */
const DEEPSEEK_FLASH: Rates = {
  inPerM: 0.44,
  outPerM: 1.32,
  cacheReadPerM: 0.014,
  cacheWritePerM: null,
};

const PROBE_RATES = new Map<string, Rates>([["DeepSeek-V4-Flash", DEEPSEEK_FLASH]]);

function tokensOf(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): Pick<RunMetrics, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"> {
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

// ── computeCost ──────────────────────────────────────────────────────────────

describe("computeCost", () => {
  it("prices a hand-worked example, defaulting cache write to 1.25x and cache read to 0.1x input", () => {
    const rates: Rates = { inPerM: 2, outPerM: 10, cacheReadPerM: null, cacheWritePerM: null };
    // 1M in @ $2 = 2.00 | 100k out @ $10 = 1.00
    // 500k cache read @ 0.1 * $2 = $0.20/MTok = 0.10
    // 200k cache write @ 1.25 * $2 = $2.50/MTok = 0.50
    expect(computeCost(tokensOf(1_000_000, 100_000, 500_000, 200_000), rates)).toBeCloseTo(3.6, 10);
  });

  it("prefers an explicit cache rate over the ratio default", () => {
    const rates: Rates = { inPerM: 2, outPerM: 10, cacheReadPerM: 1, cacheWritePerM: 4 };
    // 500k @ $1 = 0.50 | 200k @ $4 = 0.80, instead of 0.10 / 0.50 above.
    expect(computeCost(tokensOf(0, 0, 500_000, 200_000), rates)).toBeCloseTo(1.3, 10);
  });

  it("never treats cached tokens as free just because no cache rate was solved", () => {
    const rates: Rates = { inPerM: 3, outPerM: 15, cacheReadPerM: null, cacheWritePerM: null };
    expect(computeCost(tokensOf(0, 0, 1_000_000, 0), rates)).toBeGreaterThan(0);
  });

  it("returns 0 only when there are genuinely no tokens", () => {
    expect(computeCost(tokensOf(0, 0, 0, 0), DEEPSEEK_FLASH)).toBe(0);
  });
});

// ── resolveRates ─────────────────────────────────────────────────────────────

describe("normaliseModelId", () => {
  it("strips a trailing -eu and a trailing date, in either combination", () => {
    expect(normaliseModelId("claude-opus-4-8-eu")).toBe("claude-opus-4-8");
    expect(normaliseModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normaliseModelId("claude-sonnet-4-6-eu-20251001")).toBe("claude-sonnet-4-6");
    expect(normaliseModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("leaves a non-Claude id that merely contains digits alone", () => {
    expect(normaliseModelId("DeepSeek-V4-Flash")).toBe("DeepSeek-V4-Flash");
    expect(normaliseModelId("glm-5.3-flash")).toBe("glm-5.3-flash");
  });
});

describe("resolveRates", () => {
  it("takes a non-Claude id from the probe map", () => {
    expect(resolveRates("DeepSeek-V4-Flash", PROBE_RATES)).toEqual(DEEPSEEK_FLASH);
  });

  it("takes a Claude id from the committed list table", () => {
    expect(resolveRates("claude-haiku-4-5", PROBE_RATES)).toEqual(
      CLAUDE_LIST_RATES["claude-haiku-4-5"],
    );
    expect(resolveRates("claude-fable-5", new Map())?.inPerM).toBe(10);
  });

  it("normalises -eu and dated aliases onto their base entry", () => {
    expect(resolveRates("claude-opus-4-8-eu", new Map())).toEqual(
      CLAUDE_LIST_RATES["claude-opus-4-8"],
    );
    expect(resolveRates("claude-haiku-4-5-20251001", new Map())).toEqual(
      CLAUDE_LIST_RATES["claude-haiku-4-5"],
    );
  });

  it("returns null for an id neither side knows", () => {
    expect(resolveRates("nemotron-3-ultra", PROBE_RATES)).toBeNull();
    expect(isClaudeListId("nemotron-3-ultra")).toBe(false);
  });

  it("covers every ccbench Claude candidate", () => {
    for (const id of [
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]) {
      expect(isClaudeListId(id)).toBe(true);
    }
  });
});

// ── priceRun ─────────────────────────────────────────────────────────────────

describe("priceRun", () => {
  it("marks a probe-priced id measured", () => {
    const priced = priceRun(
      { modelId: "DeepSeek-V4-Flash", tokens: tokensOf(1_000_000, 0, 0, 0), reportedCostUsd: 9 },
      PROBE_RATES,
    );
    expect(priced.basis).toBe("measured");
    expect(priced.costUsd).toBeCloseTo(0.44, 10);
  });

  it("marks a Claude id list, ignoring any probe row for it", () => {
    const probe = new Map([["claude-haiku-4-5", DEEPSEEK_FLASH]]);
    const priced = priceRun(
      { modelId: "claude-haiku-4-5", tokens: tokensOf(1_000_000, 0, 0, 0), reportedCostUsd: null },
      probe,
    );
    expect(priced).toEqual({ costUsd: 1, basis: "list" });
  });

  it("keeps the CLI's number when no rate card resolves - never zeroes it", () => {
    const priced = priceRun(
      { modelId: "nemotron-3-ultra", tokens: tokensOf(500, 20, 0, 0), reportedCostUsd: 0.252245 },
      PROBE_RATES,
    );
    expect(priced).toEqual({ costUsd: 0.252245, basis: "list" });
  });

  it("reports unpriced as null, not 0, when there is neither a rate card nor a CLI figure", () => {
    const priced = priceRun(
      { modelId: "nemotron-3-ultra", tokens: tokensOf(500, 20, 0, 0), reportedCostUsd: null },
      PROBE_RATES,
    );
    expect(priced).toEqual({ costUsd: null, basis: "unpriced" });
  });

  it("keeps a genuine measured zero distinct from unpriced", () => {
    // Zero rates over real tokens is a free run and must price as 0 — as
    // opposed to zero tokens, which is a run that never happened (below).
    const freeRates = new Map(PROBE_RATES);
    freeRates.set("free-model", { inPerM: 0, outPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 });
    const priced = priceRun(
      { modelId: "free-model", tokens: tokensOf(500, 20, 0, 0), reportedCostUsd: null },
      freeRates,
    );
    expect(priced.costUsd).toBe(0);
    expect(priced.basis).toBe("measured");
  });

  it("prices a run that billed no tokens as unpriced, never as free", () => {
    // The ~190s retry-storm failures die before the first API call lands and
    // bill nothing. Calling that $0 would hand the best possible cost term to a
    // model that produced no work at all.
    const priced = priceRun(
      { modelId: "DeepSeek-V4-Flash", tokens: tokensOf(0, 0, 0, 0), reportedCostUsd: 0 },
      PROBE_RATES,
    );
    expect(priced).toEqual({ costUsd: null, basis: "unpriced" });
  });
});

// ── the bug this module exists for ───────────────────────────────────────────

function metricsFor(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    ...harnessErrorMetrics("unused", 0),
    ok: true,
    failure: "none",
    durationMs: 10_000,
    numTurns: 4,
    toolCalls: 10,
    toolErrors: 0,
    maxParallelWidth: 1,
    ttftMs: 800,
    notes: [],
    ...overrides,
  };
}

function runFor(
  modelId: string,
  taskId: string,
  metrics: Partial<RunMetrics>,
  costBasis: CostBasis = "list",
): BenchRunResult {
  return {
    suiteId: "screen",
    modelId,
    taskId,
    attempt: 1,
    startedAt: "2026-08-31T10:00:00.000Z",
    metrics: metricsFor(metrics),
    grade: { score: 1, passed: true, checks: [{ name: "check", ok: true }] },
    transcriptPath: `/tmp/${modelId}-${taskId}.jsonl`,
    costBasis,
  };
}

describe("non-Claude cost regression", () => {
  // Verbatim from the `screen` suite's stored DeepSeek-V4-Flash / locate row:
  // the CLI billed it at $0.213 while `claude-haiku-4-5` came in at ~$0.06 for
  // the same two tasks. DeepSeek's real rate is $0.44/$1.32 per MTok against
  // haiku's $1/$5, so the true figure has to land *below* haiku's, not 5x above.
  const TOKENS = tokensOf(37_085, 561, 7_040, 0);
  const CLI_REPORTED = 0.21327;

  const deepseek = priceRun(
    { modelId: "DeepSeek-V4-Flash", tokens: TOKENS, reportedCostUsd: CLI_REPORTED },
    PROBE_RATES,
  );
  const haiku = priceRun(
    { modelId: "claude-haiku-4-5", tokens: TOKENS, reportedCostUsd: null },
    PROBE_RATES,
  );

  it("prices DeepSeek-V4-Flash below claude-haiku-4-5 on identical token counts", () => {
    expect(deepseek.costUsd).not.toBeNull();
    expect(haiku.costUsd).not.toBeNull();
    expect(deepseek.costUsd as number).toBeLessThan(haiku.costUsd as number);
  });

  it("differs from the CLI's Claude-tier figure by more than an order of magnitude", () => {
    expect(deepseek.costUsd).not.toBeCloseTo(CLI_REPORTED, 4);
    expect(deepseek.costUsd as number).toBeCloseTo(0.01715648, 8);
    expect((deepseek.costUsd as number) * 10).toBeLessThan(CLI_REPORTED);
  });

  it("records the two bases distinctly", () => {
    expect(deepseek.basis).toBe("measured");
    expect(haiku.basis).toBe("list");
  });

  it("re-prices a finished run in place of the CLI's number", () => {
    const repriced = priceRunResult(
      runFor("DeepSeek-V4-Flash", "locate", { ...TOKENS, costUsd: CLI_REPORTED }),
      PROBE_RATES,
    );
    expect(repriced.costBasis).toBe("measured");
    expect(repriced.metrics.costUsd).toBeCloseTo(0.01715648, 8);
    // The source run is untouched - the runner keeps its results immutable.
    expect(repriced.metrics.durationMs).toBe(10_000);
  });
});

// ── report rendering ─────────────────────────────────────────────────────────

const TASKS = [
  { id: "locate", measures: ["search" as const, "tool_use" as const] },
  { id: "batch-read", measures: ["tool_use" as const] },
];

function reportInputFor(results: BenchRunResult[]) {
  const summaries = perModel(results, TASKS);
  return {
    suiteId: "screen",
    generatedAt: "2026-08-31T12:00:00.000Z",
    taskIds: TASKS.map((t) => t.id),
    summaries,
    composites: composite(summaries),
    taskScores: perTask(results),
    results,
  };
}

describe("renderReport cost basis", () => {
  const mixed = reportInputFor([
    runFor("DeepSeek-V4-Flash", "locate", { costUsd: 0.017 }, "measured"),
    runFor("claude-haiku-4-5", "locate", { costUsd: 0.04 }, "list"),
    runFor("nemotron-3-ultra", "locate", { costUsd: null }, "unpriced"),
  ]);
  const markdown = renderReport(mixed);

  it("names the mixed basis in the caveat and adds a per-row basis column", () => {
    expect(markdown).toContain("Cost basis is **mixed**");
    expect(markdown).toContain("| basis |");
    expect(markdown).toMatch(/\| DeepSeek-V4-Flash \|.*\| measured \|/);
    expect(markdown).toMatch(/\| claude-haiku-4-5 \|.*\| list \|/);
    expect(markdown).toMatch(/\| nemotron-3-ultra \|.*\| unpriced \|/);
  });

  it("renders an unpriced row as a dash, never $0.000", () => {
    const row = markdown.split("\n").find((line) => line.startsWith("| nemotron-3-ultra |"));
    expect(row).toContain("—");
    expect(row).not.toContain("$0");
    expect(markdown).not.toContain("NaN");
  });

  it("keeps a genuinely-zero cost visible as $0 rather than a dash", () => {
    const free = renderReport(
      reportInputFor([runFor("glm-5.3-flash", "locate", { costUsd: 0 }, "measured")]),
    );
    const row = free.split("\n").find((line) => line.startsWith("| glm-5.3-flash |"));
    expect(row).toContain("$0");
    expect(row).not.toContain("—");
  });

  it("names a uniform measured basis in the caveat and the cost header", () => {
    const measured = renderReport(
      reportInputFor([
        runFor("DeepSeek-V4-Flash", "locate", { costUsd: 0.017 }, "measured"),
        runFor("glm-5.3-flash", "locate", { costUsd: 0.009 }, "measured"),
      ]),
    );
    expect(measured).toContain("Cost basis: **measured**");
    expect(measured).toContain("cost (measured)");
    expect(measured).not.toContain("| basis |");
  });

  it("names a uniform unpriced basis and dashes every cost cell", () => {
    const unpriced = renderReport(
      reportInputFor([runFor("nemotron-3-ultra", "locate", { costUsd: null }, "unpriced")]),
    );
    expect(unpriced).toContain("Cost basis: **unpriced**");
    expect(unpriced).not.toContain("$0");
  });

  it("keeps the list-basis wording for an all-Claude suite", () => {
    const list = renderReport(
      reportInputFor([runFor("claude-haiku-4-5", "locate", { costUsd: 0.04 }, "list")]),
    );
    expect(list).toContain("list pricing");
    expect(list).toContain("cost (list)");
  });
});

describe("toJson cost basis", () => {
  it("reports mixed for a mixed suite and carries the per-run basis", () => {
    const json = toJson(
      reportInputFor([
        runFor("DeepSeek-V4-Flash", "locate", { costUsd: 0.017 }, "measured"),
        runFor("claude-haiku-4-5", "locate", { costUsd: 0.04 }, "list"),
      ]),
    );
    expect(json.cost_basis).toBe("mixed");
    expect(json.runs.map((r) => r.cost_basis).toSorted()).toEqual(["list", "measured"]);
  });

  it("reports the shared basis when every run agrees", () => {
    const json = toJson(
      reportInputFor([runFor("DeepSeek-V4-Flash", "locate", { costUsd: 0.017 }, "measured")]),
    );
    expect(json.cost_basis).toBe("measured");
  });
});

// ── scoring must not confuse cheap with unknown ──────────────────────────────

describe("unpriced never becomes zero in scoring", () => {
  it("gives an unpriced model the worst cost term while a genuinely-free one gets the best", () => {
    const summaries = perModel(
      [
        runFor("free", "locate", { costUsd: 0 }, "measured"),
        runFor("cheap", "locate", { costUsd: 0.1 }, "measured"),
        runFor("pricey", "locate", { costUsd: 0.4 }, "measured"),
        runFor("unknown", "locate", { costUsd: null }, "unpriced"),
      ],
      TASKS,
    );
    const rows = composite(summaries);
    // A measured 0 is the best price there is; "we don't know" takes the worst
    // observed term (0.1/0.4) instead of free-riding on the same zero.
    expect(rows.find((r) => r.modelId === "free")?.costTerm).toBe(1);
    expect(rows.find((r) => r.modelId === "unknown")?.costTerm).toBeCloseTo(0.25, 10);
    expect(summaries.find((s) => s.modelId === "unknown")?.totalCostUsd).toBeNull();
  });

  it("keeps totalCostUsd null - not 0 - for a model whose every run is unpriced", () => {
    const summaries = perModel(
      [
        runFor("unknown", "locate", { costUsd: null }, "unpriced"),
        runFor("unknown", "batch-read", { costUsd: null }, "unpriced"),
      ],
      TASKS,
    );
    expect(summaries[0]?.totalCostUsd).toBeNull();
    expect(summaries[0]?.costPerPassedTask).toBeNull();
  });
});
