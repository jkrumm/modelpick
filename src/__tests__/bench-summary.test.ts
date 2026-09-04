import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  buildAaLookup,
  buildBenchSummary,
  buildRateCards,
  caveatLines,
  chooseSuite,
  derivePicks,
  EU_FALLBACK_ID,
  lookupAa,
  rateCardFor,
  summariseSuites,
  type AaMetricRow,
  type BenchModelRow,
  type RateProbeRow,
  type SuiteInfo,
} from "../server/bench/summary.js";
import type { BenchRunResult, RunMetrics } from "../server/bench/types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const ZERO_METRICS: RunMetrics = {
  ok: true,
  failure: "none",
  durationMs: 1000,
  apiDurationMs: 900,
  ttftMs: 100,
  numTurns: 5,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  thinkingTokens: 0,
  costUsd: 1,
  toolCalls: 10,
  toolCallsByName: {},
  toolErrors: 0,
  parallelBatches: 1,
  maxParallelWidth: 2,
  apiErrors: 0,
  terminalReason: "end_turn",
  filesEdited: [],
  notes: [],
};

function run(
  modelId: string,
  taskId: string,
  overrides: Partial<RunMetrics> & { score?: number } = {},
): BenchRunResult {
  const { score = 1, ...metrics } = overrides;
  return {
    suiteId: "t",
    modelId,
    taskId,
    attempt: 1,
    startedAt: "2026-08-31 12:00:00",
    transcriptPath: "",
    costBasis: "measured",
    metrics: { ...ZERO_METRICS, ...metrics },
    grade: { score, passed: score >= 1, checks: [] },
  };
}

/** A model that ran both tasks with the given cost and wall clock per run. */
function field(
  modelId: string,
  costUsd: number | null,
  durationMs: number,
  score: number | { timeouts: number; scoreOnTimeout: number } = 1,
): BenchRunResult[] {
  if (typeof score === "number") {
    return ["a", "b"].map((taskId) => run(modelId, taskId, { costUsd, durationMs, score }));
  }
  // Clock-limited variant: `timeouts` of the tasks were killed on the budget and
  // carry a partial score; the rest are clean 1.00s.
  const taskIds = ["a", "b", "c", "d"];
  return taskIds.map((taskId, i) => {
    const timedOut = i < score.timeouts;
    const result = run(modelId, taskId, {
      costUsd,
      durationMs,
      score: timedOut ? score.scoreOnTimeout : 1,
    });
    return timedOut
      ? { ...result, metrics: { ...result.metrics, failure: "timeout" as const, ok: false } }
      : result;
  });
}

const AA_ROWS: AaMetricRow[] = [
  { model_id: "fast-one", metric: "quality", value: 40, captured_at: "2026-08-31 10:00:00" },
  { model_id: "fast-one", metric: "coding_index", value: 55, captured_at: "2026-08-31 10:00:00" },
  { model_id: "cheap-one", metric: "quality", value: 50, captured_at: "2026-08-31 10:00:00" },
  { model_id: "tied-one", metric: "quality", value: 20, captured_at: "2026-08-31 10:00:00" },
];

function summaryOf(runs: BenchRunResult[], aaRows: AaMetricRow[] = AA_ROWS) {
  return buildBenchSummary({ suiteId: "t", runs, aaRows, probes: [] });
}

// ── AA lookup ────────────────────────────────────────────────────────────────

describe("buildAaLookup / lookupAa", () => {
  it("takes the newest capture per metric", () => {
    const lookup = buildAaLookup([
      { model_id: "m", metric: "quality", value: 10, captured_at: "2026-01-01 00:00:00" },
      { model_id: "m", metric: "quality", value: 20, captured_at: "2026-06-01 00:00:00" },
    ]);
    expect(lookupAa("m", lookup)?.intelligence).toBe(20);
  });

  it("matches a dated AA alias onto the route's bare id", () => {
    const lookup = buildAaLookup([
      {
        model_id: "claude-haiku-4-5-20251001",
        metric: "quality",
        value: 24.1,
        captured_at: "2026-08-31 00:00:00",
      },
    ]);
    const hit = lookupAa("claude-haiku-4-5", lookup);
    expect(hit?.intelligence).toBe(24.1);
    expect(hit?.approximate).toBe(false);
  });

  it("flags an aliased near-neighbour as approximate", () => {
    const lookup = buildAaLookup([
      { model_id: "GLM-5.3", metric: "quality", value: 59.5, captured_at: "2026-08-31 00:00:00" },
    ]);
    const hit = lookupAa("glm-5.3-flash", lookup);
    expect(hit?.intelligence).toBe(59.5);
    expect(hit?.approximate).toBe(true);
  });

  it("returns null for a model the leaderboard has never rated", () => {
    expect(lookupAa("nobody", buildAaLookup([]))).toBeNull();
  });
});

// ── rate cards ───────────────────────────────────────────────────────────────

describe("rateCardFor", () => {
  const probes: RateProbeRow[] = [
    {
      model_id: "glm-5.3-flash",
      price_in_per_m: 0.075,
      price_out_per_m: 0.25,
      context_window: 1_100_000,
      context_window_exact: false,
      notes: "one | two",
    },
  ];

  it("prefers the committed Anthropic card for a Claude id", () => {
    const card = rateCardFor("claude-sonnet-5", buildRateCards(probes));
    expect(card).toMatchObject({ inPerM: 2, outPerM: 10, basis: "list", contextWindow: 1_000_000 });
  });

  it("uses the probed rates for a non-Claude id, with its caveats", () => {
    const card = rateCardFor("glm-5.3-flash", buildRateCards(probes));
    expect(card).toMatchObject({ inPerM: 0.075, basis: "measured", contextWindowExact: false });
    expect(card.notes).toEqual(["one", "two"]);
  });

  it("returns an unpriced card rather than inventing a zero", () => {
    const card = rateCardFor("unknown-model", buildRateCards(probes));
    expect(card.inPerM).toBeNull();
    expect(card.basis).toBeNull();
  });
});

// ── suite selection ──────────────────────────────────────────────────────────

describe("chooseSuite", () => {
  const suites: SuiteInfo[] = [
    { suiteId: "tmo", modelCount: 1, taskCount: 2, runCount: 4, latestAt: "2026-08-31 14:00:00" },
    {
      suiteId: "final",
      modelCount: 13,
      taskCount: 10,
      runCount: 130,
      latestAt: "2026-08-31 12:00:00",
    },
    { suiteId: "r1", modelCount: 6, taskCount: 6, runCount: 36, latestAt: "2026-08-31 08:00:00" },
  ];

  it("skips a newer suite that ranked too small a field", () => {
    expect(chooseSuite(suites, null)?.suiteId).toBe("final");
  });

  it("honours an explicit suite even when it is small", () => {
    expect(chooseSuite(suites, "tmo")?.suiteId).toBe("tmo");
  });

  it("returns null for an unknown suite rather than falling back", () => {
    expect(chooseSuite(suites, "nope")).toBeNull();
  });

  it("returns null when nothing ranked a field", () => {
    expect(chooseSuite([suites[0] as SuiteInfo], null)).toBeNull();
  });

  it("orders suites newest first", () => {
    const ordered = summariseSuites([
      { suite_id: "old", model_id: "a", task_id: "t", created_at: "2026-01-01 00:00:00" },
      { suite_id: "new", model_id: "a", task_id: "t", created_at: "2026-02-01 00:00:00" },
      { suite_id: "new", model_id: "b", task_id: "t", created_at: "2026-02-01 00:00:00" },
    ]);
    expect(ordered.map((s) => s.suiteId)).toEqual(["new", "old"]);
    expect(ordered[0]?.modelCount).toBe(2);
  });
});

// ── pick derivation ──────────────────────────────────────────────────────────

describe("derivePicks — a normal field", () => {
  const summary = summaryOf([
    ...field("fast-one", 2, 1000),
    ...field("cheap-one", 0.1, 9000),
    ...field("slow-partial", 0.01, 20_000, 0.5),
  ]);

  it("takes the fastest perfect model for interactive work", () => {
    expect(summary.picks.interactive?.modelId).toBe("fast-one");
  });

  it("takes the cheapest perfect model for an unattended worker", () => {
    expect(summary.picks.worker?.modelId).toBe("cheap-one");
  });

  it("never picks a model that did not score a flat 1.00, however cheap", () => {
    const picked = [summary.picks.interactive, summary.picks.worker].map((p) => p?.modelId);
    expect(picked).not.toContain("slow-partial");
  });

  it("has no EU pick when nothing in the field is EU-resident", () => {
    expect(summary.picks.eu).toBeNull();
  });
});

describe("derivePicks — every model at quality 1.00 (the real case)", () => {
  // Same cost, same wall clock: nothing but the tie-breakers can separate them,
  // and the answer still has to be the same on every run.
  const runs = [...field("tied-one", 1, 5000), ...field("tied-two", 1, 5000)];
  const aa: AaMetricRow[] = [
    { model_id: "tied-two", metric: "quality", value: 60, captured_at: "2026-08-31 00:00:00" },
    { model_id: "tied-one", metric: "quality", value: 20, captured_at: "2026-08-31 00:00:00" },
  ];

  it("breaks the worker tie on the external intelligence index", () => {
    expect(summaryOf(runs, aa).picks.worker?.modelId).toBe("tied-two");
  });

  it("is deterministic when the tie-breakers tie too", () => {
    const flat = summaryOf(runs, []);
    expect(flat.picks.worker?.modelId).toBe("tied-one");
    expect(flat.picks.interactive?.modelId).toBe("tied-one");
    // Order of the input rows must not change the answer.
    const reversed = summaryOf(runs.toReversed(), []);
    expect(reversed.picks.worker?.modelId).toBe(flat.picks.worker?.modelId);
    expect(reversed.picks.interactive?.modelId).toBe(flat.picks.interactive?.modelId);
  });

  it("reports the saturation and the AA spread in the caveats", () => {
    const summary = summaryOf(runs, aa);
    expect(summary.caveats.perfectCount).toBe(2);
    expect(summary.caveats.scoredCount).toBe(2);
    expect(summary.caveats.aaSpread).toMatchObject({ low: 20, high: 60 });
    expect(caveatLines(summary.caveats)[0]).toContain("2 of 2");
  });
});

describe("derivePicks — no AA data at all", () => {
  const summary = summaryOf([...field("cheap-one", 0.1, 9000), ...field("fast-one", 2, 1000)], []);

  it("still picks on the measured columns", () => {
    expect(summary.picks.interactive?.modelId).toBe("fast-one");
    expect(summary.picks.worker?.modelId).toBe("cheap-one");
  });

  it("claims no AA spread it cannot evidence", () => {
    expect(summary.caveats.aaSpread).toBeNull();
    expect(summary.models.every((row) => row.aa === null)).toBe(true);
  });
});

describe("derivePicks — the cheapest model is a documented dead end", () => {
  // `claude-opus-4-8-eu` answers /messages but cannot drive a Claude Code
  // session, so it must never win a pick no matter what its numbers say.
  const summary = summaryOf([
    ...field("claude-opus-4-8-eu", 0.001, 100),
    ...field("cheap-one", 0.1, 9000),
    ...field("fast-one", 2, 1000),
  ]);

  it("excludes it from every pick", () => {
    expect(summary.picks.interactive?.modelId).toBe("fast-one");
    expect(summary.picks.worker?.modelId).toBe("cheap-one");
    expect(summary.picks.eu?.modelId).not.toBe("claude-opus-4-8-eu");
  });

  it("keeps the row in the table, flagged and ineligible", () => {
    const row = summary.models.find((m) => m.modelId === "claude-opus-4-8-eu");
    expect(row?.incompatible).toBe(true);
    expect(row?.eligible).toBe(false);
  });

  it("carries the dead ids the suite never ran, so --all can show them", () => {
    const dead = summary.models.find((m) => m.modelId === "claude-opus-4-0");
    expect(dead).toMatchObject({ dead: true, measured: false, eligible: false });
  });
});

describe("derivePicks — EU residency", () => {
  it("takes the cheapest EU-resident id on the route", () => {
    const summary = summaryOf([
      ...field("claude-opus-5", 2.5, 9000), // eu
      ...field("claude-fable-5", 4.5, 9000), // eu, dearer
      ...field("claude-sonnet-5", 1.1, 1000), // global
    ]);
    expect(summary.picks.eu?.modelId).toBe("claude-opus-5");
    expect(summary.picks.interactive?.modelId).toBe("claude-sonnet-5");
  });

  it("falls back to the documented id only when it is actually in the field", () => {
    const rows: BenchModelRow[] = [
      {
        modelId: EU_FALLBACK_ID,
        composite: 0.5,
        quality: 1,
        passRate: 1,
        totalCostUsd: 3,
        costBasis: "list",
        totalDurationMs: 100,
        meanTurns: 5,
        meanTtftMs: 100,
        toolErrorRate: 0,
        runCount: 1,
        taskCount: 1,
        timeoutRuns: 0,
        qualityExcludingTimeouts: 1,
        aa: null,
        rate: rateCardFor(EU_FALLBACK_ID, new Map()),
        residency: "global", // pretend the survey stopped naming it EU
        dead: false,
        incompatible: false,
        measured: true,
        eligible: true,
      },
    ];
    expect(derivePicks(rows).eu?.modelId).toBe(EU_FALLBACK_ID);
    expect(derivePicks(rows).eu?.why).toContain("falling back");
    expect(derivePicks([]).eu).toBeNull();
  });
});

describe("buildBenchSummary — an empty suite", () => {
  const summary = summaryOf([]);

  it("does not throw and picks nothing", () => {
    expect(summary.picks).toEqual({ interactive: null, worker: null, eu: null });
    expect(summary.taskIds).toEqual([]);
    expect(summary.cells).toEqual([]);
  });

  it("still renders three caveat lines rather than crashing on no data", () => {
    expect(caveatLines(summary.caveats)).toHaveLength(3);
    expect(summary.caveats.aaSpread).toBeNull();
  });

  it("lists the documented dead ends and nothing measured", () => {
    expect(summary.models.every((row) => !row.measured)).toBe(true);
  });
});

describe("buildBenchSummary — matrix cells", () => {
  it("keeps a failure separate from a low score", () => {
    const summary = summaryOf([
      run("m", "a", { score: 0.5 }),
      run("m", "b", { score: 0, failure: "timeout", ok: false }),
    ]);
    const byTask = new Map(summary.cells.map((cell) => [cell.taskId, cell]));
    expect(byTask.get("a")?.failures).toEqual([]);
    expect(byTask.get("b")?.failures).toEqual(["timeout"]);
  });

  it("orders task columns the way the suite ran them", () => {
    const summary = summaryOf([run("m", "zebra"), run("m", "alpha")]);
    expect(summary.taskIds).toEqual(["zebra", "alpha"]);
  });
});

// ── the cap stdout/stderr contract ───────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Runs the real CLI against the real `modelpick.db` with stdin closed, so the
 *  picklist never opens. It makes no network call and spends nothing, which is
 *  exactly the property being asserted. `stdio[2]` is inherited rather than
 *  captured — everything human-facing goes there, and that is the point. */
function runCap(args: string[]): string {
  return execFileSync("bun", ["run", "scripts/cap.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

describe("scripts/cap.ts — stream contract", () => {
  it("writes nothing but the picklist result to stdout", () => {
    // Non-interactive: no model is chosen, so stdout must be completely empty.
    // Everything a human reads went to stderr.
    expect(runCap([])).toBe("");
  });

  it("emits parseable JSON on stdout under --json, and nothing else", () => {
    const parsed: unknown = JSON.parse(runCap(["--json"]));
    expect(parsed).toHaveProperty("picks");
    expect(parsed).toHaveProperty("models");
  });
});

describe("derivePicks — a timeout is latency, not quality", () => {
  // The case that forced this distinction: glm-5.3-flash lost 0.03 of `quality`
  // to two task-budget timeouts, then went 4/4 at 1.00 when re-run at a 4x
  // budget. The interactive pick must still reject it (a waiting human cannot
  // absorb that), the worker pick must not.
  const slowButCorrect = summaryOf([
    ...field("claude-sonnet-5", 1.127, 303_000),
    ...field("glm-5.3-flash", 0.035, 2_304_000, { timeouts: 2, scoreOnTimeout: 0.67 }),
  ]);

  it("keeps the clock-limited model out of the interactive pick", () => {
    expect(slowButCorrect.picks.interactive?.modelId).toBe("claude-sonnet-5");
  });

  it("gives the worker pick to the cheap model despite the timeouts", () => {
    expect(slowButCorrect.picks.worker?.modelId).toBe("glm-5.3-flash");
  });

  it("says out loud that runs were excluded as latency", () => {
    expect(slowButCorrect.picks.worker?.why).toContain("exceeded the task budget");
  });

  it("counts the timeouts on the row and holds both quality readings", () => {
    const row = slowButCorrect.models.find((m) => m.modelId === "glm-5.3-flash");
    expect(row?.timeoutRuns).toBe(2);
    expect(row?.qualityExcludingTimeouts).toBe(1);
    expect(row?.quality).toBeLessThan(1);
  });
});
