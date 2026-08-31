import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyFailure,
  extractFinalText,
  harnessErrorMetrics,
  parseTranscript,
} from "../server/bench/metrics.js";
import { composite, perModel, perTask } from "../server/bench/score.js";
import { renderReport, toJson } from "../server/bench/report.js";
import {
  BENCH_CONFIG_DIR_NAME,
  BENCH_CONFIG_SETTINGS,
  ensureBenchConfigDir,
  sanitizeSegment,
} from "../server/bench/sandbox.js";
import {
  REDACTION_PLACEHOLDER,
  buildSpawnArgs,
  buildSpawnEnv,
  makeRedactor,
  stripV1,
  type IuCredentials,
} from "../server/bench/spawn.js";
import { toBenchRunInsert } from "../server/bench/persist.js";
import { CCBENCH_MODELS, DEAD_IDS, EU_VARIANTS, isDeadModel } from "../server/bench/models.js";
import type { BenchRunResult, CostBasis, RunMetrics, TaskGrade } from "../server/bench/types.js";

// ── stream-json fixtures ─────────────────────────────────────────────────────
// Hand-written to the shape a live run actually emits: ONE content block per
// assistant event, a `message.id` shared across the events of one parallel
// batch, and `usage` repeated identically on every event of that message.

const SANDBOX = "/tmp/ccbench/suite/model/task-1";

function jsonl(events: unknown[]): string {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

function assistantToolUse(messageId: string, name: string, input: unknown): unknown {
  return {
    type: "assistant",
    message: {
      id: messageId,
      content: [{ type: "tool_use", id: `toolu_${Math.random()}`, name, input }],
      // Repeated identically on every event of this message - summing it would
      // multiply the bill, which is why the parser ignores it.
      usage: { input_tokens: 5000, output_tokens: 200 },
      stop_reason: null,
    },
  };
}

function resultEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "result",
    subtype: "success",
    num_turns: 4,
    duration_ms: 21_000,
    duration_api_ms: 15_000,
    ttft_ms: 820,
    total_cost_usd: 0.0421,
    is_error: false,
    api_error_status: null,
    terminal_reason: "completed",
    result: "Done - renamed the helper and updated both call sites.",
    permission_denials: [],
    usage: {
      input_tokens: 120,
      output_tokens: 640,
      cache_creation_input_tokens: 20_500,
      cache_read_input_tokens: 41_000,
      output_tokens_details: { thinking_tokens: 310 },
      service_tier: "standard",
    },
    modelUsage: {
      "claude-haiku-4-5": {
        inputTokens: 120,
        outputTokens: 640,
        cacheReadInputTokens: 41_000,
        cacheCreationInputTokens: 20_500,
        costUSD: 0.0421,
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        provider: "iu",
        costBasis: "list",
      },
    },
    ...overrides,
  };
}

const PARALLEL_STREAM = jsonl([
  { type: "system", subtype: "init", model: "claude-haiku-4-5", tools: ["Read"], mcp_servers: [] },
  // Three Read calls sharing one message id: one parallel batch of width 3.
  assistantToolUse("msg_01parallel", "Read", { file_path: `${SANDBOX}/src/a.ts` }),
  assistantToolUse("msg_01parallel", "Read", { file_path: `${SANDBOX}/src/b.ts` }),
  assistantToolUse("msg_01parallel", "Read", { file_path: `${SANDBOX}/src/c.ts` }),
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: null, content: "ok" }],
    },
  },
  assistantToolUse("msg_02edit", "Edit", { file_path: `${SANDBOX}/src/a.ts` }),
  assistantToolUse("msg_03edit", "Write", {
    file_path: "/private/tmp/ccbench/suite/model/task-1/src/new.ts",
  }),
  // Same file again, from a different message - must dedupe.
  assistantToolUse("msg_04edit", "Edit", { file_path: `${SANDBOX}/src/a.ts` }),
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_2",
          is_error: true,
          content: "String not found",
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_3",
          is_error: true,
          content: "File not read yet",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      id: "msg_05text",
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 5000, output_tokens: 200 },
      stop_reason: "end_turn",
    },
  },
  resultEvent(),
]);

describe("parseTranscript", () => {
  it("detects a parallel batch by shared message.id, not by blocks per event", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    expect(metrics.parallelBatches).toBe(1);
    expect(metrics.maxParallelWidth).toBe(3);
    expect(metrics.toolCalls).toBe(6);
    expect(metrics.toolCallsByName).toEqual({ Read: 3, Edit: 2, Write: 1 });
  });

  it("reports maxParallelWidth 1 when every tool call is on its own message id", () => {
    const serial = jsonl([
      assistantToolUse("msg_a", "Read", { file_path: `${SANDBOX}/a.ts` }),
      assistantToolUse("msg_b", "Read", { file_path: `${SANDBOX}/b.ts` }),
      resultEvent(),
    ]);
    const metrics = parseTranscript({ raw: serial, durationMs: 1000, sandboxDir: SANDBOX });
    expect(metrics.parallelBatches).toBe(0);
    expect(metrics.maxParallelWidth).toBe(1);
  });

  it("reports maxParallelWidth 0 when no tool was called at all", () => {
    const noTools = jsonl([
      {
        type: "assistant",
        message: { id: "msg_x", content: [{ type: "text", text: "hi" }], usage: {} },
      },
      resultEvent(),
    ]);
    expect(parseTranscript({ raw: noTools, durationMs: 500 }).maxParallelWidth).toBe(0);
  });

  it("counts only tool_result blocks flagged is_error", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    expect(metrics.toolErrors).toBe(2);
  });

  it("extracts edited files, makes them sandbox-relative, and dedupes", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    // Reads never count as edits; /private/tmp is normalised onto /tmp.
    expect(metrics.filesEdited).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("takes usage from the result event rather than summing the repeated per-message usage", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    // Six assistant events each carry input_tokens 5000; summing gives 30000.
    expect(metrics.inputTokens).toBe(120);
    expect(metrics.outputTokens).toBe(640);
    expect(metrics.cacheCreationTokens).toBe(20_500);
    expect(metrics.cacheReadTokens).toBe(41_000);
    expect(metrics.thinkingTokens).toBe(310);
    expect(metrics.costUsd).toBeCloseTo(0.0421, 6);
  });

  it("uses the runner's wall clock, not the CLI's duration_ms", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    expect(metrics.durationMs).toBe(22_000);
    expect(metrics.apiDurationMs).toBe(15_000);
    expect(metrics.ttftMs).toBe(820);
  });

  it("marks a clean run ok with failure none", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      sandboxDir: SANDBOX,
    });
    expect(metrics.ok).toBe(true);
    expect(metrics.failure).toBe("none");
    expect(metrics.terminalReason).toBe("completed");
  });

  it("survives a truncated stream with no result event", () => {
    const truncated = `${jsonl([
      { type: "system", subtype: "init", model: "claude-haiku-4-5" },
      assistantToolUse("msg_a", "Read", { file_path: `${SANDBOX}/a.ts` }),
    ]).trimEnd()}\n{"type":"assis`;
    const metrics = parseTranscript({ raw: truncated, durationMs: 9000, sandboxDir: SANDBOX });
    expect(metrics.ok).toBe(false);
    expect(metrics.failure).toBe("harness_error");
    expect(metrics.notes.some((n) => n.includes("without a result event"))).toBe(true);
    expect(metrics.notes.some((n) => n.includes("malformed"))).toBe(true);
    expect(metrics.numTurns).toBe(1);
  });

  it("skips a malformed line, notes it, and keeps parsing the rest", () => {
    const raw = [
      JSON.stringify({ type: "system", subtype: "init" }),
      "{ this is not json",
      JSON.stringify(resultEvent()),
    ].join("\n");
    const metrics = parseTranscript({ raw, durationMs: 1000 });
    expect(metrics.notes[0]).toBe("1 malformed transcript line(s) skipped");
    expect(metrics.ok).toBe(true);
    expect(metrics.numTurns).toBe(4);
  });

  it("treats the unrecognized_model stderr line as expected telemetry", () => {
    const metrics = parseTranscript({
      raw: PARALLEL_STREAM,
      durationMs: 22_000,
      stderr: "[claude-code:unrecognized_model] claude-haiku-4-5",
    });
    expect(metrics.notes).toEqual([]);
    expect(metrics.failure).toBe("none");
  });

  it("classifies a killed run as a timeout even when the stream looks clean", () => {
    const metrics = parseTranscript({ raw: PARALLEL_STREAM, durationMs: 600_000, killed: true });
    expect(metrics.failure).toBe("timeout");
    expect(metrics.ok).toBe(false);
  });

  it("classifies the turn cap as max_turns, not as an api error", () => {
    const raw = jsonl([
      resultEvent({ subtype: "error_max_turns", is_error: true, terminal_reason: "max_turns" }),
    ]);
    const metrics = parseTranscript({ raw, durationMs: 30_000 });
    expect(metrics.failure).toBe("max_turns");
    expect(metrics.apiErrors).toBe(0);
  });

  it("classifies an api_error_status as api_error", () => {
    const raw = jsonl([
      assistantToolUse("msg_a", "Read", { file_path: `${SANDBOX}/a.ts` }),
      resultEvent({ subtype: "error_during_execution", is_error: true, api_error_status: 529 }),
    ]);
    const metrics = parseTranscript({ raw, durationMs: 5000 });
    expect(metrics.failure).toBe("api_error");
    expect(metrics.apiErrors).toBe(1);
  });

  it("classifies a first-turn 4xx naming the model as incompatible", () => {
    expect(
      classifyFailure({
        killed: false,
        hasResult: true,
        subtype: "error_during_execution",
        terminalReason: null,
        isError: true,
        apiErrorStatus: 400,
        apiErrors: 1,
        assistantMessages: 0,
        errorText: "400 invalid_request_error: model does not support tools",
        exitCode: 1,
      }),
    ).toBe("incompatible");
  });
});

describe("extractFinalText", () => {
  it("prefers the result event's final text", () => {
    expect(extractFinalText(PARALLEL_STREAM)).toBe(
      "Done - renamed the helper and updated both call sites.",
    );
  });

  it("falls back to the last assistant text block on a truncated stream", () => {
    const raw = jsonl([
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "first" }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "second" }] } },
    ]);
    expect(extractFinalText(raw)).toBe("second");
  });
});

// ── scoring ──────────────────────────────────────────────────────────────────

function metricsFor(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    ...harnessErrorMetrics("unused", 0),
    ok: true,
    failure: "none",
    durationMs: 10_000,
    numTurns: 4,
    costUsd: 0.1,
    toolCalls: 10,
    toolErrors: 0,
    maxParallelWidth: 1,
    ttftMs: 800,
    notes: [],
    ...overrides,
  };
}

function gradeFor(score: number): TaskGrade {
  return { score, passed: score >= 1, checks: [{ name: "check", ok: score >= 1 }] };
}

function runFor(
  modelId: string,
  taskId: string,
  score: number,
  metrics: Partial<RunMetrics> = {},
  attempt = 1,
  costBasis: CostBasis = "list",
): BenchRunResult {
  return {
    suiteId: "suite",
    modelId,
    taskId,
    attempt,
    startedAt: "2026-08-31T10:00:00.000Z",
    metrics: metricsFor(metrics),
    grade: gradeFor(score),
    transcriptPath: `/tmp/${modelId}-${taskId}-${attempt}.jsonl`,
    costBasis,
  };
}

const TASKS = [
  { id: "locate", measures: ["search" as const, "tool_use" as const] },
  { id: "refactor", measures: ["coding" as const, "multi_file" as const] },
];

describe("perTask", () => {
  it("averages repeats and only passes when every attempt passed", () => {
    const rows = perTask([runFor("a", "locate", 1, {}, 1), runFor("a", "locate", 0.5, {}, 2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(2);
    expect(rows[0]?.score).toBeCloseTo(0.75, 6);
    expect(rows[0]?.passed).toBe(false);
  });
});

describe("perModel", () => {
  it("aggregates quality, pass rate, dimensions and tool fidelity", () => {
    const summaries = perModel(
      [runFor("a", "locate", 1), runFor("a", "refactor", 0.5, { toolCalls: 10, toolErrors: 2 })],
      TASKS,
    );
    const a = summaries[0];
    expect(a?.quality).toBeCloseTo(0.75, 6);
    expect(a?.passRate).toBeCloseTo(0.5, 6);
    expect(a?.dimensions.search).toBeCloseTo(1, 6);
    expect(a?.dimensions.coding).toBeCloseTo(0.5, 6);
    expect(a?.dimensions.recovery).toBeNull();
    expect(a?.toolErrorRate).toBeCloseTo(0.1, 6);
    expect(a?.totalCostUsd).toBeCloseTo(0.2, 6);
  });

  it("reports toolErrorRate 0 rather than NaN when no tool was ever called", () => {
    const summaries = perModel([runFor("a", "locate", 1, { toolCalls: 0, toolErrors: 0 })], TASKS);
    expect(summaries[0]?.toolErrorRate).toBe(0);
  });

  it("measures parallelism as the share of tasks with a batch of two or more", () => {
    const summaries = perModel(
      [
        runFor("a", "locate", 1, { maxParallelWidth: 3 }),
        runFor("a", "refactor", 1, { maxParallelWidth: 1 }),
      ],
      TASKS,
    );
    expect(summaries[0]?.parallelism).toBeCloseTo(0.5, 6);
  });

  it("returns null costPerPassedTask when nothing passed, never Infinity", () => {
    const summaries = perModel([runFor("a", "locate", 0), runFor("a", "refactor", 0)], TASKS);
    expect(summaries[0]?.costPerPassedTask).toBeNull();
  });

  it("returns null totalCostUsd when every run reported no cost", () => {
    const summaries = perModel([runFor("a", "locate", 1, { costUsd: null })], TASKS);
    expect(summaries[0]?.totalCostUsd).toBeNull();
    expect(summaries[0]?.costPerPassedTask).toBeNull();
  });

  it("counts failures per reason", () => {
    const summaries = perModel(
      [
        runFor("a", "locate", 0, { ok: false, failure: "timeout" }),
        runFor("a", "refactor", 0, { ok: false, failure: "timeout" }),
      ],
      TASKS,
    );
    expect(summaries[0]?.failures).toEqual({ timeout: 2 });
  });
});

describe("composite", () => {
  it("weights quality 0.50, cost 0.20, speed 0.20 and tool fidelity 0.10", () => {
    const summaries = perModel([runFor("only", "locate", 1)], TASKS);
    const [row] = composite(summaries);
    // Single model in the field: it is both cheapest and fastest.
    expect(row?.costTerm).toBe(1);
    expect(row?.speedTerm).toBe(1);
    expect(row?.composite).toBeCloseTo(1, 6);
  });

  it("normalises cost and speed as best/value", () => {
    const summaries = perModel(
      [
        runFor("cheap", "locate", 1, { costUsd: 0.1, durationMs: 10_000 }),
        runFor("pricey", "locate", 1, { costUsd: 0.2, durationMs: 20_000 }),
      ],
      TASKS,
    );
    const rows = composite(summaries);
    const pricey = rows.find((r) => r.modelId === "pricey");
    expect(pricey?.costTerm).toBeCloseTo(0.5, 6);
    expect(pricey?.speedTerm).toBeCloseTo(0.5, 6);
    // 0.5*1 + 0.2*0.5 + 0.2*0.5 + 0.1*1 = 0.8
    expect(pricey?.composite).toBeCloseTo(0.8, 6);
    expect(rows[0]?.modelId).toBe("cheap");
  });

  it("does not let a model that failed everything win on being cheap", () => {
    const summaries = perModel(
      [
        runFor("broken", "locate", 0, {
          ok: false,
          failure: "incompatible",
          costUsd: 0.001,
          durationMs: 400,
        }),
        runFor("working", "locate", 1, { costUsd: 0.5, durationMs: 60_000 }),
      ],
      TASKS,
    );
    const rows = composite(summaries);
    expect(rows[0]?.modelId).toBe("working");
    const broken = rows.find((r) => r.modelId === "broken");
    expect(broken?.costTerm).toBe(0);
    expect(broken?.speedTerm).toBe(0);
    expect(broken?.composite).toBeCloseTo(0.1, 6);
  });

  it("goes neutral on the cost term when no run reported a cost", () => {
    const summaries = perModel(
      [
        runFor("a", "locate", 1, { costUsd: null, durationMs: 10_000 }),
        runFor("b", "locate", 1, { costUsd: null, durationMs: 10_000 }),
      ],
      TASKS,
    );
    for (const row of composite(summaries)) expect(row.costTerm).toBe(1);
  });

  it("goes neutral on the cost term when every reported cost is zero", () => {
    const summaries = perModel(
      [runFor("a", "locate", 1, { costUsd: 0 }), runFor("b", "locate", 1, { costUsd: 0 })],
      TASKS,
    );
    for (const row of composite(summaries)) expect(row.costTerm).toBe(1);
  });

  it("gives a model with no cost data the worst observed cost term", () => {
    const summaries = perModel(
      [
        runFor("cheap", "locate", 1, { costUsd: 0.1 }),
        runFor("pricey", "locate", 1, { costUsd: 0.4 }),
        runFor("unknown", "locate", 1, { costUsd: null }),
      ],
      TASKS,
    );
    const rows = composite(summaries);
    expect(rows.find((r) => r.modelId === "unknown")?.costTerm).toBeCloseTo(0.25, 6);
  });

  it("penalises tool errors through the fidelity term", () => {
    const summaries = perModel([runFor("a", "locate", 1, { toolCalls: 10, toolErrors: 5 })], TASKS);
    const [row] = composite(summaries);
    expect(row?.toolFidelityTerm).toBeCloseTo(0.5, 6);
    expect(row?.composite).toBeCloseTo(0.95, 6);
  });
});

// ── report ───────────────────────────────────────────────────────────────────

function reportInputFor(results: BenchRunResult[]) {
  const summaries = perModel(results, TASKS);
  return {
    suiteId: "2026-08-31-1200",
    generatedAt: "2026-08-31T12:00:00.000Z",
    taskIds: TASKS.map((t) => t.id),
    summaries,
    composites: composite(summaries),
    taskScores: perTask(results),
    results,
  };
}

describe("renderReport", () => {
  const input = reportInputFor([
    runFor("claude-haiku-4-5", "locate", 1),
    runFor("claude-haiku-4-5", "refactor", 0.5, { toolErrors: 1, failure: "max_turns", ok: false }),
    runFor("claude-opus-5", "locate", 1, { costUsd: null }),
    runFor("claude-opus-5", "refactor", 1, {
      costUsd: null,
      notes: ["2 malformed transcript line(s) skipped"],
    }),
  ]);
  const markdown = renderReport(input);

  it("renders all four sections", () => {
    expect(markdown).toContain("## Leaderboard");
    expect(markdown).toContain("## Per-task scores");
    expect(markdown).toContain("## Per-dimension scores");
    expect(markdown).toContain("## Failures and notes");
  });

  it("uses minimum-separator markdown tables, never padded or box-drawn", () => {
    expect(markdown).toContain("|-|-|-|-|-|-|-|-|");
    expect(markdown).not.toMatch(/\|\s*-{3,}/);
    expect(markdown).not.toMatch(/[┌┬─│└┘├┤┼+]{2,}/);
  });

  it("renders a null cost as a dash, never NaN or null", () => {
    const opusRow = markdown.split("\n").find((line) => line.startsWith("| claude-opus-5 |"));
    expect(opusRow).toContain("—");
    expect(markdown).not.toContain("NaN");
    expect(markdown).not.toContain("| null |");
  });

  it("labels cost as list basis so nobody reads it as an IU invoice", () => {
    expect(markdown).toContain("list pricing");
    expect(markdown).toContain("cost (list)");
  });

  it("marks pass/fail per task cell in plain ascii", () => {
    expect(markdown).toMatch(/\| 1\.00 y \|/);
    expect(markdown).toMatch(/\| 0\.50 n \|/);
  });

  it("lists every failure and parser note", () => {
    expect(markdown).toContain("failure: `max_turns`");
    expect(markdown).toContain("2 malformed transcript line(s) skipped");
  });

  it("shows a dash for a dimension no task measured", () => {
    const dimensionTable = markdown.slice(markdown.indexOf("## Per-dimension scores"));
    expect(dimensionTable).toContain("recovery");
    expect(dimensionTable).toContain("—");
  });

  it("banners a dry run so a synthetic table is never mistaken for a measurement", () => {
    expect(renderReport({ ...input, dryRun: true })).toContain("**Dry run.**");
    expect(markdown).not.toContain("**Dry run.**");
  });
});

describe("report toJson", () => {
  it("carries the leaderboard, per-task rows and raw runs with a list cost basis", () => {
    const json = toJson(reportInputFor([runFor("claude-haiku-4-5", "locate", 1)]));
    expect(json.cost_basis).toBe("list");
    expect(json.dry_run).toBe(false);
    expect(json.leaderboard[0]?.model_id).toBe("claude-haiku-4-5");
    expect(json.per_task[0]?.task_id).toBe("locate");
    expect(json.runs[0]?.transcript_path).toContain("locate");
  });
});

// ── isolated config dir ──────────────────────────────────────────────────────

describe("ensureBenchConfigDir", () => {
  it("writes only settings.json - no CLAUDE.md, agents, skills or commands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccbench-config-test-"));
    try {
      const dir = await ensureBenchConfigDir(root);
      expect(path.basename(dir)).toBe(BENCH_CONFIG_DIR_NAME);

      const entries = await fs.readdir(dir);
      expect(entries).toEqual(["settings.json"]);
      for (const forbidden of ["CLAUDE.md", "agents", "skills", "commands"]) {
        expect(entries).not.toContain(forbidden);
      }

      const settings: unknown = JSON.parse(
        await fs.readFile(path.join(dir, "settings.json"), "utf8"),
      );
      expect(settings).toEqual(BENCH_CONFIG_SETTINGS);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("wipes carry-over state on refresh", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccbench-config-test-"));
    try {
      const dir = await ensureBenchConfigDir(root);
      await fs.writeFile(path.join(dir, "CLAUDE.md"), "leaked", "utf8");
      await fs.mkdir(path.join(dir, "skills"), { recursive: true });

      const refreshed = await fs.readdir(await ensureBenchConfigDir(root));
      expect(refreshed).toEqual(["settings.json"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

// ── spawn construction ───────────────────────────────────────────────────────

const CREDENTIALS: IuCredentials = {
  apiKey: "test-key",
  baseUrl: "https://unified-endpoint-main.example/anthropic",
  source: "keychain",
};

describe("buildSpawnArgs", () => {
  const args = buildSpawnArgs({
    modelId: "claude-haiku-4-5",
    maxTurns: 25,
    prompt: "do the thing",
  });

  it("uses stream-json with an empty strict mcp config", () => {
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
  });

  it("pins the model and the turn cap and puts the prompt last", () => {
    expect(args[args.indexOf("--model") + 1]).toBe("claude-haiku-4-5");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("25");
    expect(args.at(-1)).toBe("do the thing");
  });

  it("skips permissions so no run stalls on a prompt nobody can answer", () => {
    expect(args).toContain("--dangerously-skip-permissions");
  });
});

describe("buildSpawnEnv", () => {
  const env = buildSpawnEnv({
    modelId: "claude-sonnet-5",
    credentials: CREDENTIALS,
    configDir: "/repo/.ccbench-config",
    baseEnv: { ANTHROPIC_API_KEY: "leftover", PATH: "/usr/bin", EMPTY: undefined },
  });

  it("removes ANTHROPIC_API_KEY rather than setting it empty", () => {
    // claude v2.x rejects an empty key with "Not logged in" - it must be absent.
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBe("test-key");
  });

  it("pins all four model tiers to the same gateway id", () => {
    expect(env["ANTHROPIC_DEFAULT_OPUS_MODEL"]).toBe("claude-sonnet-5");
    expect(env["ANTHROPIC_DEFAULT_SONNET_MODEL"]).toBe("claude-sonnet-5");
    expect(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"]).toBe("claude-sonnet-5");
    expect(env["ANTHROPIC_DEFAULT_FABLE_MODEL"]).toBe("claude-sonnet-5");
  });

  it("isolates the config dir and points the CLI at the IU base url", () => {
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/repo/.ccbench-config");
    expect(env["ANTHROPIC_BASE_URL"]).toBe(CREDENTIALS.baseUrl);
  });

  it("carries the rest of the parent env through", () => {
    expect(env["PATH"]).toBe("/usr/bin");
    expect("EMPTY" in env).toBe(false);
  });
});

describe("makeRedactor", () => {
  const SECRET = "sk-iu-0123456789abcdef";

  /** Drives a chunk stream through a redactor the way spawnClaude does. */
  function stream(chunks: string[]): string {
    const redactor = makeRedactor(SECRET);
    return `${chunks.map((chunk) => redactor.push(chunk)).join("")}${redactor.flush()}`;
  }

  it("replaces the token inside a single chunk", () => {
    const out = stream([`{"env":"ANTHROPIC_AUTH_TOKEN=${SECRET}"}\n`]);
    expect(out).not.toContain(SECRET);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("catches a token split across two chunks", () => {
    const cut = 7;
    const out = stream([`prefix ${SECRET.slice(0, cut)}`, `${SECRET.slice(cut)} suffix\n`]);
    expect(out).not.toContain(SECRET);
    expect(out).toBe(`prefix ${REDACTION_PLACEHOLDER} suffix\n`);
  });

  it("catches a token split one character at a time", () => {
    const out = stream([...`a${SECRET}b`]);
    expect(out).not.toContain(SECRET);
    expect(out).toBe(`a${REDACTION_PLACEHOLDER}b`);
  });

  it("passes clean output through byte-for-byte once flushed", () => {
    const text = '{"type":"result","subtype":"success"}\n';
    expect(stream([text.slice(0, 10), text.slice(10)])).toBe(text);
  });

  it("redacts every occurrence, not just the first", () => {
    const out = stream([`${SECRET} and ${SECRET}`]);
    expect(out).toBe(`${REDACTION_PLACEHOLDER} and ${REDACTION_PLACEHOLDER}`);
  });

  it("is a pass-through when there is no secret to hide", () => {
    const redactor = makeRedactor("");
    expect(redactor.push("anything")).toBe("anything");
    expect(redactor.flush()).toBe("");
  });
});

describe("stripV1", () => {
  it("drops the /v1 the REST probes need but the CLI must not get", () => {
    expect(stripV1("https://host/anthropic/v1")).toBe("https://host/anthropic");
    expect(stripV1("https://host/anthropic/v1/")).toBe("https://host/anthropic");
    expect(stripV1("https://host/anthropic")).toBe("https://host/anthropic");
  });
});

// ── sandbox paths + persistence mapping ──────────────────────────────────────

describe("sanitizeSegment", () => {
  it("keeps hyphens and flattens dots so a model id is path-safe", () => {
    expect(sanitizeSegment("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(sanitizeSegment("gpt-5.6-luna")).toBe("gpt-5_6-luna");
    expect(sanitizeSegment("../escape")).toBe("escape");
  });
});

describe("toBenchRunInsert", () => {
  it("serialises checks and pipe-joins notes, nulling an empty note list", () => {
    const withNotes = toBenchRunInsert(runFor("a", "locate", 1, { notes: ["one", "two"] }));
    expect(withNotes.notes).toBe("one | two");
    expect(JSON.parse(withNotes.checks_json)).toEqual([{ name: "check", ok: true }]);
    expect(toBenchRunInsert(runFor("a", "locate", 1)).notes).toBeNull();
  });

  it("rounds fractional millisecond timings for the integer columns", () => {
    const row = toBenchRunInsert(runFor("a", "locate", 1, { durationMs: 1234.7, ttftMs: 820.4 }));
    expect(row.duration_ms).toBe(1235);
    expect(row.ttft_ms).toBe(820);
  });
});

describe("candidate set", () => {
  it("keeps the six verified ids out of the known-dead list", () => {
    expect(CCBENCH_MODELS).toHaveLength(6);
    for (const id of CCBENCH_MODELS) expect(isDeadModel(id)).toBe(false);
    expect(DEAD_IDS.every(isDeadModel)).toBe(true);
  });

  it("maps EU twins onto their parent ids", () => {
    expect(EU_VARIANTS["claude-haiku-4-5"]).toBe("claude-haiku-4-5-eu");
    for (const parent of Object.keys(EU_VARIANTS)) expect(CCBENCH_MODELS).toContain(parent);
  });
});
