import { describe, it, expect, vi, beforeEach } from "vitest";
import { isClaudeModel, listAnthropicModels, anthropicMessage } from "../server/pick/anthropic.js";
import { solveCost } from "../server/pick/cost-solve.js";
import { probeCache } from "../server/pick/cache-probe.js";
import { probeMaxTokens } from "../server/pick/max-tokens-probe.js";
import { discoverContextWindow } from "../server/pick/context-window.js";
import {
  rowFromCache,
  rowFromLiveProbe,
  rowFromSeed,
  verdictFor,
  isUsableForAgentLoop,
  sortByOutputPriceAsc,
  renderTable,
  launchLine,
  type ComparisonRow,
} from "../server/pick/format.js";
import { formatCostEstimateLine } from "../server/pick/cost-estimate.js";
import type { PickProbe } from "../db/schema.js";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_ANTHROPIC_BASE_URL"] = "https://iu-test.example/anthropic/v1";
  process.env["IU_API_KEY"] = "test-key";
});

// ── isClaudeModel ────────────────────────────────────────────────────────────

describe("isClaudeModel", () => {
  it("matches claude-* ids", () => {
    expect(isClaudeModel("claude-sonnet-5")).toBe(true);
    expect(isClaudeModel("claude-opus-4-8")).toBe(true);
  });

  it("rejects non-Claude ids", () => {
    expect(isClaudeModel("DeepSeek-V4-Flash")).toBe(false);
    expect(isClaudeModel("glm-5.3-flash")).toBe(false);
  });
});

// ── listAnthropicModels ──────────────────────────────────────────────────────

describe("listAnthropicModels", () => {
  it("extracts ids from a {data: [...]} listing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ id: "claude-sonnet-5" }, { id: "DeepSeek-V4-Flash" }] }),
    );

    const ids = await listAnthropicModels();
    expect(ids).toEqual(["claude-sonnet-5", "DeepSeek-V4-Flash"]);
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    await expect(listAnthropicModels()).rejects.toThrow(/HTTP 500/);
  });
});

// ── anthropicMessage ─────────────────────────────────────────────────────────

describe("anthropicMessage", () => {
  it("detects a thinking content block", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        content: [
          { type: "thinking", thinking: "..." },
          { type: "text", text: "hi" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 10 },
      }),
    );

    const res = await anthropicMessage({
      model: "glm-5.3-flash",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.ok).toBe(true);
    expect(res.hasThinking).toBe(true);
    expect(res.stopReason).toBe("end_turn");
  });

  it("surfaces the error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { message: "bad request" } }));

    const res = await anthropicMessage({
      model: "qwen3.7-max",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.ok).toBe(false);
    expect(res.errorText).toBe("bad request");
  });
});

// ── solveCost ────────────────────────────────────────────────────────────────

describe("solveCost", () => {
  it("solves priceIn/priceOut from two usage.cost data points", async () => {
    // priceIn=0.44/1M, priceOut=1.32/1M — DeepSeek-V4-Flash's known rate.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ type: "text", text: "yes" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 20, output_tokens: 5, cost: (20 * 0.44 + 5 * 1.32) / 1e6 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ type: "text", text: "long..." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 30, output_tokens: 500, cost: (30 * 0.44 + 500 * 1.32) / 1e6 },
        }),
      );

    const result = await solveCost("DeepSeek-V4-Flash");
    expect(result.reliable).toBe(true);
    expect(result.priceInPerM).toBeCloseTo(0.44, 6);
    expect(result.priceOutPerM).toBeCloseTo(1.32, 6);
  });

  it("marks unreliable when no usage.cost is present (real Claude route)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const result = await solveCost("claude-sonnet-5");
    expect(result.reliable).toBe(false);
    expect(result.priceInPerM).toBeNull();
    expect(result.note).toMatch(/usage.cost/);
  });

  it("marks unreliable when both calls produce the same output length", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5, cost: 0.001 },
      }),
    );

    const result = await solveCost("some-model");
    expect(result.reliable).toBe(false);
  });
});

// ── probeCache ───────────────────────────────────────────────────────────────

describe("probeCache", () => {
  it("detects a cache hit on the second identical call", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3000, output_tokens: 2, cache_creation_input_tokens: 3000 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 3000 },
        }),
      );

    const result = await probeCache("DeepSeek-V4-Flash");
    expect(result.supportsCacheRead).toBe(true);
  });

  it("reports no cache support when cache_read_input_tokens is absent", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 2 },
      }),
    );

    const result = await probeCache("NVIDIA-Nemotron-3-Super-120B-A12B");
    expect(result.supportsCacheRead).toBe(false);
  });
});

// ── probeMaxTokens ───────────────────────────────────────────────────────────

describe("probeMaxTokens", () => {
  it("honors max_tokens when stop_reason is max_tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        content: [{ type: "text", text: "1, 2, 3" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 64 },
      }),
    );

    const result = await probeMaxTokens("DeepSeek-V4-Flash");
    expect(result.honorsMaxTokens).toBe(true);
  });

  it("flags an ignored cap when the model runs to completion instead", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        content: [{ type: "text", text: "1, 2, 3, ... 300" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2400 },
      }),
    );

    const result = await probeMaxTokens("glm-5.3-flash");
    expect(result.honorsMaxTokens).toBe(false);
    expect(result.note).toMatch(/ignored max_tokens/);
  });
});

// ── discoverContextWindow ────────────────────────────────────────────────────

describe("discoverContextWindow", () => {
  it("parses an exact token limit named in the error and skips the search", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { message: "Your request exceeded model token limit: 262144" },
      }),
    );

    const result = await discoverContextWindow("kimi-k2.7-code");
    expect(result.contextWindow).toBe(262144);
    expect(result.exact).toBe(true);
    expect(result.callsUsed).toBe(1);
  });

  it("derives an approximate window from a byte-cap error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(413, { error: { message: "Request body too large: 6291456 bytes" } }),
    );

    const result = await discoverContextWindow("qwen3.7-max");
    expect(result.exact).toBe(false);
    expect(result.contextWindow).toBe(Math.round(6291456 / 4));
    expect(result.note).toMatch(/byte/);
  });

  it("returns the ceiling when the largest filler is accepted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        content: [{ type: "text", text: "x" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 1_100_000, output_tokens: 1 },
      }),
    );

    const result = await discoverContextWindow("some-huge-context-model");
    expect(result.contextWindow).toBe(1_100_000);
    expect(result.exact).toBe(false);
  });

  it("binary-searches when the overflow message names no number", async () => {
    // Ceiling rejects with generic wording, every subsequent probe also rejects
    // — the search should converge downward and stop at the floor.
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { message: "input is too long" } }));

    const result = await discoverContextWindow("some-model");
    expect(result.exact).toBe(false);
    expect(result.contextWindow).toBe(8_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

// ── format.ts row builders + rendering ────────────────────────────────────────

function makeRow(overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    modelId: "DeepSeek-V4-Flash",
    priceInPerM: 0.44,
    priceOutPerM: 1.32,
    priceCacheReadPerM: 0.014,
    supportsCacheRead: true,
    honorsMaxTokens: true,
    alwaysThinking: true,
    contextWindow: 1_000_000,
    contextWindowExact: false,
    source: "live",
    notes: [],
    ...overrides,
  };
}

describe("rowFromSeed", () => {
  it("fills known quirks for kimi-k2.7-code", () => {
    const row = rowFromSeed("kimi-k2.7-code");
    expect(row.contextWindow).toBe(262144);
    expect(row.contextWindowExact).toBe(true);
    expect(row.priceOutPerM).toBeCloseTo(4.0);
  });

  it("flags GLM-5.1 as not honouring max_tokens", () => {
    const row = rowFromSeed("GLM-5.1");
    expect(row.honorsMaxTokens).toBe(false);
  });

  it("returns nulls for a model with no seed entry", () => {
    const row = rowFromSeed("some-unknown-model");
    expect(row.priceInPerM).toBeNull();
    expect(row.honorsMaxTokens).toBeNull();
  });
});

describe("rowFromCache", () => {
  it("maps a pick_probe DB row 1:1", () => {
    const dbRow: PickProbe = {
      id: 1,
      model_id: "hy3",
      price_in_per_m: 0.14,
      price_out_per_m: 0.58,
      price_cache_read_per_m: 0.035,
      supports_cache_read: true,
      honors_max_tokens: true,
      always_thinking: true,
      context_window: 128_000,
      context_window_exact: false,
      notes: "a | b",
      probed_at: "2026-08-28",
    };
    const row = rowFromCache(dbRow);
    expect(row.source).toBe("cached");
    expect(row.notes).toEqual(["a", "b"]);
  });
});

describe("rowFromLiveProbe", () => {
  it("carries the probe result through unchanged", () => {
    const row = rowFromLiveProbe({
      modelId: "minimax-m3",
      priceInPerM: 0.3,
      priceOutPerM: 1.2,
      priceCacheReadPerM: 0.06,
      supportsCacheRead: true,
      honorsMaxTokens: true,
      alwaysThinking: true,
      contextWindow: 256_000,
      contextWindowExact: false,
      notes: ["note"],
    });
    expect(row.source).toBe("live");
    expect(row.modelId).toBe("minimax-m3");
  });
});

describe("verdictFor", () => {
  it("flags a clean pick", () => {
    expect(verdictFor(makeRow({ alwaysThinking: false, supportsCacheRead: false }))).toMatch(
      /clean/,
    );
  });

  it("flags always-reasons and cache-friendly separately from clean", () => {
    const v = verdictFor(makeRow());
    expect(v).toContain("always reasons");
    expect(v).toContain("cache-friendly");
  });

  it("flags ignored max_tokens and unavailable cost", () => {
    const v = verdictFor(
      makeRow({ honorsMaxTokens: false, priceInPerM: null, priceOutPerM: null }),
    );
    expect(v).toContain("ignores max_tokens");
    expect(v).toContain("cost unavailable");
  });
});

describe("isUsableForAgentLoop", () => {
  it("excludes models with no known price", () => {
    expect(isUsableForAgentLoop(makeRow({ priceInPerM: null }))).toBe(false);
  });

  it("excludes models that ignore max_tokens", () => {
    expect(isUsableForAgentLoop(makeRow({ honorsMaxTokens: false }))).toBe(false);
  });

  it("includes a fully-known, capped, priced model", () => {
    expect(isUsableForAgentLoop(makeRow())).toBe(true);
  });
});

describe("sortByOutputPriceAsc", () => {
  it("sorts ascending by output price, unknowns last", () => {
    const rows = [
      makeRow({ modelId: "expensive", priceOutPerM: 7.5 }),
      makeRow({ modelId: "unknown", priceOutPerM: null }),
      makeRow({ modelId: "cheap", priceOutPerM: 0.25 }),
    ];
    const sorted = sortByOutputPriceAsc(rows);
    expect(sorted.map((r) => r.modelId)).toEqual(["cheap", "expensive", "unknown"]);
  });
});

describe("renderTable", () => {
  it("renders a header plus one line per row, sorted ascending", () => {
    const rows = [
      makeRow({ modelId: "glm-5.2", priceOutPerM: 4.4 }),
      makeRow({ modelId: "glm-5.3-flash", priceOutPerM: 0.25 }),
    ];
    const table = renderTable(rows);
    const lines = table.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/model/);
    expect(lines[1]).toContain("glm-5.3-flash");
    expect(lines[2]).toContain("glm-5.2");
  });
});

describe("launchLine", () => {
  it("prints the ca launcher line with no credentials", () => {
    expect(launchLine("DeepSeek-V4-Flash")).toBe("ca DeepSeek-V4-Flash");
  });
});

// ── cost-estimate ────────────────────────────────────────────────────────────

describe("formatCostEstimateLine", () => {
  it("reports nothing to probe for an empty list", () => {
    expect(formatCostEstimateLine([])).toMatch(/nothing needs probing|No models need probing/i);
  });

  it("estimates a positive dollar figure for a non-empty list", () => {
    const line = formatCostEstimateLine(["DeepSeek-V4-Flash", "some-unseeded-model"]);
    expect(line).toMatch(/\$\d+\.\d{2}/);
    expect(line).toContain("2 model(s)");
  });
});
