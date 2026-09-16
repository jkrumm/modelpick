import { describe, it, expect, vi, beforeEach } from "vitest";
import { compareVersions, createIdResolver, versionOf } from "../server/collectors/normalize.js";
import { collectOpenRouter } from "../server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../server/collectors/artificialanalysis.js";
import {
  parseCsv,
  parseCsvRecords,
  parseBenchmarkIndex,
  stripEffortSuffix,
  extractScores,
} from "../server/collectors/epoch.js";
import { benchmarkSaturation } from "../server/collectors/epoch-benchmarks.js";
import { collectEqbench, extractEmbeddedCsv } from "../server/collectors/eqbench.js";
import { collectLmarena } from "../server/collectors/lmarena.js";

const resolve = createIdResolver(["claude-sonnet-4-6", "gpt-5.5", "tts-hd", "whisper"]);

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  process.env["OPENROUTER_API_KEY"] = "test-or-key";
  process.env["ARTIFICIALANALYSIS_API_KEY"] = "test-aa-key";
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

// ── createIdResolver ─────────────────────────────────────────────────────────────

describe("createIdResolver", () => {
  it("returns exact match for a known local ID", () => {
    expect(resolve("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips provider prefix for OpenRouter-style IDs", () => {
    expect(resolve("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips provider prefix for a different provider", () => {
    expect(resolve("openai/gpt-5.5")).toBe("gpt-5.5");
  });

  it("returns null for unknown external ID", () => {
    expect(resolve("some/unknown-model-xyz-9000")).toBeNull();
  });

  it("matches case-insensitively via canonical form", () => {
    expect(resolve("Claude-Sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("matches across separator/date noise via canonical form", () => {
    // "gpt-5-5" canonicalises to the same form as known "gpt-5.5"
    expect(resolve("openai/gpt-5-5-2026-04-23")).toBe("gpt-5.5");
  });

  it("returns exact match for TTS model", () => {
    expect(resolve("tts-hd")).toBe("tts-hd");
  });

  it("returns exact match for STT model", () => {
    expect(resolve("whisper")).toBe("whisper");
  });
});

// ── versionOf ─────────────────────────────────────────────────────────────────

describe("versionOf", () => {
  it("splits a dotted version into family + version, tier word kept in family", () => {
    expect(versionOf("gemini-3.5-flash")).toEqual({ family: "gemini-flash", version: "3.5" });
  });

  it("splits a dashed multi-segment version", () => {
    expect(versionOf("GLM-5.3")).toEqual({ family: "glm", version: "5.3" });
    expect(versionOf("claude-opus-4-8")).toEqual({ family: "claude-opus", version: "4.8" });
  });

  it("returns a null version for ids with no numeric token run", () => {
    expect(versionOf("gpt-4o")).toEqual({ family: "gpt-4o", version: null });
  });

  it("never mistakes a tier word for part of the version", () => {
    const v = versionOf("gemini-3.5-flash-lite");
    expect(v.version).toBe("3.5");
    expect(v.family).toBe("gemini-flash-lite");
  });
});

// ── compareVersions ───────────────────────────────────────────────────────────

describe("compareVersions", () => {
  it("orders numerically, not lexicographically — 3.10 beats 3.9", () => {
    expect(compareVersions("3.10", "3.9")).toBeGreaterThan(0);
  });

  it("orders a higher major version above a lower one", () => {
    expect(compareVersions("5.3", "4.5")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareVersions("4.8", "4.8")).toBe(0);
  });
});

// ── collectOpenRouter ──────────────────────────────────────────────────────────

const OR_FIXTURE = {
  data: [
    {
      id: "anthropic/claude-sonnet-4-6",
      name: "Anthropic: Claude Sonnet 4.6",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      created: 1750000000,
    },
    {
      id: "openai/gpt-5.5",
      name: "OpenAI: GPT-5.5",
      context_length: 128000,
      pricing: { prompt: "0.000005", completion: "0.000020" },
      created: 1760000000,
    },
    {
      id: "some/totally-unknown-model",
      name: "Unknown Model",
      context_length: 8192,
      pricing: { prompt: "0.000001", completion: "0.000002" },
    },
  ],
};

describe("collectOpenRouter", () => {
  it("normalizes matched models into price_in, price_out, context_window metrics", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));

    const result = await collectOpenRouter(resolve);

    // claude-sonnet-4-6 and gpt-5.5 both match → 4 metrics each = 8 total
    expect(result.metrics).toHaveLength(8);

    const priceIn = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "price_in",
    );
    expect(priceIn).toBeDefined();
    // 0.000003 per token × 1_000_000 = 3.0 per million tokens
    expect(priceIn?.value).toBeCloseTo(3.0);
    expect(priceIn?.source).toBe("openrouter");
    expect(priceIn?.confidence).toBe(0.9);
  });

  it("converts per-token pricing to per-million-token pricing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter(resolve);

    const priceOut = result.metrics.find(
      (m) => m.model_id === "gpt-5.5" && m.metric === "price_out",
    );
    // 0.000020 × 1_000_000 = 20.0
    expect(priceOut?.value).toBeCloseTo(20.0);
  });

  it("captures context_window metric", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter(resolve);

    const ctx = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "context_window",
    );
    expect(ctx?.value).toBe(200000);
  });

  it("captures release_date metric from the created unix timestamp", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter(resolve);

    const releaseDate = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "release_date",
    );
    expect(releaseDate?.value).toBe(1750000000);
    expect(releaseDate?.source).toBe("openrouter");
  });

  it("records unmatched external models separately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter(resolve);

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.externalId).toBe("some/totally-unknown-model");
  });

  it("returns empty result on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403));
    const result = await collectOpenRouter(resolve);

    expect(result.metrics).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it("returns empty result on fetch throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const result = await collectOpenRouter(resolve);

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when API key is missing", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    const result = await collectOpenRouter(resolve);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics).toHaveLength(0);
  });

  it("sets Authorization header with the API key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    await collectOpenRouter(resolve);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-or-key");
  });
});

// ── collectArtificialAnalysis ──────────────────────────────────────────────────

const AA_FIXTURE_ARRAY: unknown[] = [
  {
    id: "c99f3bde-7c08-4de8-bd5c-8ee9123ebffa",
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    evaluations: {
      artificial_analysis_intelligence_index: 78.5,
      artificial_analysis_coding_index: 82.0,
      artificial_analysis_math_index: 70.1,
      mmlu_pro: 0.88,
      gpqa: 0.7,
      hle: null,
      livecodebench: 0.65,
      scicode: null,
      math_500: 0.95,
      aime: null,
      aime_25: 0.5,
      ifbench: 0.6,
      lcr: 0.72,
      terminalbench_hard: 0.3,
      terminalbench_v2_1: 0.81,
      tau2: 0.55,
      tau_banking: 0.4,
    },
    pricing: {
      price_1m_input_tokens: 3.0,
      price_1m_output_tokens: 15.0,
    },
    median_output_tokens_per_second: 95.2,
    median_time_to_first_token_seconds: 0.42,
  },
  {
    id: "f0083258-8646-45b8-8082-7aaf6c2ea82a",
    slug: "gpt-5-5",
    name: "GPT-5.5",
    evaluations: {
      artificial_analysis_intelligence_index: 85.0,
    },
    pricing: null,
    median_output_tokens_per_second: null,
    median_time_to_first_token_seconds: 0.31,
  },
  {
    id: "16149b9c-a1e9-4669-a5cb-ff3c00d78f89",
    slug: "completely-unknown-model-abc",
    name: "Unknown Model",
    evaluations: { artificial_analysis_intelligence_index: 60.0 },
    pricing: null,
    median_output_tokens_per_second: 50.0,
    median_time_to_first_token_seconds: 0.5,
  },
];

// AA may also return a wrapped object
const AA_FIXTURE_WRAPPED = { models: AA_FIXTURE_ARRAY };

describe("collectArtificialAnalysis — direct array response", () => {
  it("maps quality, throughput, latency_p50, price_in, price_out from LLMs endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    // claude-sonnet-4-6: quality + coding_index + throughput + latency_p50 + price_in + price_out (6)
    // + 12 non-null extra evals (math_index, mmlu_pro, gpqa, livecodebench, math_500, aime_25,
    // ifbench, lcr, terminalbench_hard, terminalbench_v2_1, tau2, tau_banking) = 18
    // (hle, scicode, aime are null in the fixture and must not appear)
    // gpt-5.5: quality + latency_p50 = 2
    expect(result.metrics.length).toBe(20);
  });

  it("maps quality metric from intelligence_index", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const quality = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "quality",
    );
    expect(quality?.value).toBeCloseTo(78.5);
    expect(quality?.source).toBe("artificialanalysis");
    expect(quality?.confidence).toBe(0.9);
  });

  it("maps coding_index metric from coding_index", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const coding = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "coding_index",
    );
    expect(coding?.value).toBeCloseTo(82.0);
    // gpt-5.5 has no coding index — must be skipped
    const gptCoding = result.metrics.find(
      (m) => m.model_id === "gpt-5.5" && m.metric === "coding_index",
    );
    expect(gptCoding).toBeUndefined();
  });

  it("maps throughput from median_output_tokens_per_second", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const throughput = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "throughput",
    );
    expect(throughput?.value).toBeCloseTo(95.2);
  });

  it("maps latency_p50 from median_time_to_first_token_seconds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const latency = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "latency_p50",
    );
    expect(latency?.value).toBeCloseTo(0.42);
  });

  it("skips null metric values gracefully", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    // gpt-5.5 has null pricing and null throughput — should not appear
    const gptMetrics = result.metrics.filter((m) => m.model_id === "gpt-5.5");
    const metricNames = gptMetrics.map((m) => m.metric);
    expect(metricNames).not.toContain("price_in");
    expect(metricNames).not.toContain("price_out");
    expect(metricNames).not.toContain("throughput");
  });

  it("maps the extended eval set, including the agentic benchmarks", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const byMetric = new Map(
      result.metrics
        .filter((m) => m.model_id === "claude-sonnet-4-6")
        .map((m) => [m.metric, m.value]),
    );
    expect(byMetric.get("math_index")).toBeCloseTo(70.1);
    expect(byMetric.get("mmlu_pro")).toBeCloseTo(0.88);
    expect(byMetric.get("gpqa")).toBeCloseTo(0.7);
    expect(byMetric.get("livecodebench")).toBeCloseTo(0.65);
    expect(byMetric.get("math_500")).toBeCloseTo(0.95);
    expect(byMetric.get("aime_25")).toBeCloseTo(0.5);
    expect(byMetric.get("ifbench")).toBeCloseTo(0.6);
    expect(byMetric.get("lcr")).toBeCloseTo(0.72);
    expect(byMetric.get("terminalbench_hard")).toBeCloseTo(0.3);
    expect(byMetric.get("terminalbench_v2_1")).toBeCloseTo(0.81);
    expect(byMetric.get("tau2")).toBeCloseTo(0.55);
    expect(byMetric.get("tau_banking")).toBeCloseTo(0.4);
  });

  it("never emits a row for a null eval — missing must not become zero", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    const metricNames = result.metrics
      .filter((m) => m.model_id === "claude-sonnet-4-6")
      .map((m) => m.metric);
    // hle, scicode, aime are explicitly null in the fixture
    expect(metricNames).not.toContain("hle");
    expect(metricNames).not.toContain("scicode");
    expect(metricNames).not.toContain("aime");
  });

  it("records unmatched external model IDs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.externalId).toBe("completely-unknown-model-abc");
  });
});

describe("collectArtificialAnalysis — wrapped object response", () => {
  it("extracts models from { models: [] } wrapper", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_WRAPPED));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.metrics.length).toBeGreaterThan(0);
  });
});

describe("collectArtificialAnalysis — error handling", () => {
  it("returns empty result on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result on fetch throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when API key is missing", async () => {
    delete process.env["ARTIFICIALANALYSIS_API_KEY"];
    const result = await collectArtificialAnalysis(resolve);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics).toHaveLength(0);
  });

  it("sets x-api-key header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    await collectArtificialAnalysis(resolve);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("x-api-key")).toBe("test-aa-key");
  });
});

// ── epoch: parseCsv / parseCsvRecords ───────────────────────────────────────

describe("parseCsv", () => {
  it("splits a simple unquoted row", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,b\n"1, 2",3\n')).toEqual([
      ["a", "b"],
      ["1, 2", "3"],
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('a\n"He said ""hi"""\n')).toEqual([["a"], ['He said "hi"']]);
  });

  it("keeps a literal newline embedded inside a quoted field", () => {
    const csv = 'a,b\n"line one\nline two",3\n';
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["line one\nline two", "3"],
    ]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("a naive split(',') would corrupt this row — parseCsv must not", () => {
    const csv = 'id,notes\n1,"comma, inside quotes"\n';
    const naive = csv.split("\n")[1]?.split(",");
    expect(naive?.length).toBe(3); // proof the naive approach breaks
    expect(parseCsv(csv)[1]).toEqual(["1", "comma, inside quotes"]);
  });
});

describe("parseCsvRecords", () => {
  it("maps rows to header-keyed records", () => {
    const records = parseCsvRecords("Model version,mean_score\nglm-5.2_max,0.787\n");
    expect(records).toEqual([{ "Model version": "glm-5.2_max", mean_score: "0.787" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});

// ── epoch: reasoning-effort suffix ──────────────────────────────────────────

describe("stripEffortSuffix", () => {
  it("strips a known effort suffix and ranks max highest", () => {
    expect(stripEffortSuffix("claude-fable-5-1_max").baseId).toBe("claude-fable-5-1");
    const max = stripEffortSuffix("claude-fable-5-1_max").rank;
    const xhigh = stripEffortSuffix("claude-fable-5-1_xhigh").rank;
    const high = stripEffortSuffix("claude-fable-5-1_high").rank;
    const medium = stripEffortSuffix("claude-fable-5-1_medium").rank;
    const low = stripEffortSuffix("claude-fable-5-1_low").rank;
    expect(max).toBeGreaterThan(xhigh);
    expect(xhigh).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
  });

  it("ranks none and unknown at the same, lowest level", () => {
    const none = stripEffortSuffix("gpt-5.6-luna_none").rank;
    const unknown = stripEffortSuffix("gpt-5.6-luna_unknown").rank;
    const low = stripEffortSuffix("gpt-5.6-luna_low").rank;
    expect(none).toBe(unknown);
    expect(low).toBeGreaterThan(none);
  });

  it("does not strip a hyphenated 'max' that's part of the model name", () => {
    // real Epoch data: "qwen3.7-max" is a model name, not an effort tier —
    // only an underscore-prefixed suffix is a reasoning-effort marker
    expect(stripEffortSuffix("qwen3.7-max").baseId).toBe("qwen3.7-max");
  });

  it("treats a bare id with no suffix the same as 'unknown'", () => {
    const bare = stripEffortSuffix("claude-opus-5").rank;
    const unknown = stripEffortSuffix("claude-opus-5_unknown").rank;
    expect(bare).toBe(unknown);
  });

  it("is case-insensitive on the suffix", () => {
    expect(stripEffortSuffix("Model_HIGH").baseId).toBe("Model");
  });
});

// ── epoch: benchmark_metadata.csv parsing ───────────────────────────────────

describe("parseBenchmarkIndex", () => {
  const header =
    "benchmark,in_eci,source_file,score_column,scale,random_baseline,score_ceiling,release_date,superseded_by\n";

  it("parses a fully populated row", () => {
    const csv = `${header}GPQA diamond,True,gpqa_diamond.csv,Best score (across scorers),1.0,0.25,1.0,2023-11-20,\n`;
    expect(parseBenchmarkIndex(csv)).toEqual([
      {
        benchmark: "GPQA diamond",
        in_eci: true,
        source_file: "gpqa_diamond.csv",
        score_column: "Best score (across scorers)",
        scale: 1,
        random_baseline: 0.25,
        score_ceiling: 1.0,
        release_date: "2023-11-20",
        superseded_by: null,
      },
    ]);
  });

  it("treats a blank source_file/score_column as null, not empty string", () => {
    const csv = `${header}CursorBench,False,,,1.0,0.0,1.0,,\n`;
    const row = parseBenchmarkIndex(csv)[0];
    expect(row?.source_file).toBeNull();
    expect(row?.score_column).toBeNull();
    expect(row?.in_eci).toBe(false);
  });

  it("defaults scale to 1 when blank", () => {
    const csv = `${header}Foo,True,foo.csv,Score,,0.0,1.0,,\n`;
    expect(parseBenchmarkIndex(csv)[0]?.scale).toBe(1);
  });
});

// ── epoch: extractScores ─────────────────────────────────────────────────────

describe("extractScores", () => {
  const header = "Model version,mean_score,Best score (across scorers)\n";

  it("keeps a single row for a model with no effort suffix", () => {
    const csv = `${header}claude-opus-5,0.8,0.8\n`;
    const scores = extractScores(csv, "Best score (across scorers)", 1);
    expect(scores.get("claude-opus-5")?.value).toBe(0.8);
  });

  it("keeps only the highest-effort-tier row for a model with several tiers", () => {
    const csv = `${header}claude-fable-5-1_low,0.2,0.2\nclaude-fable-5-1_max,0.9,0.9\nclaude-fable-5-1_medium,0.5,0.5\n`;
    const scores = extractScores(csv, "Best score (across scorers)", 1);
    expect(scores.size).toBe(1);
    expect(scores.get("claude-fable-5-1")?.value).toBe(0.9);
  });

  it("never emits a row for a blank score", () => {
    const csv = `${header}some-model,,\n`;
    const scores = extractScores(csv, "Best score (across scorers)", 1);
    expect(scores.has("some-model")).toBe(false);
  });

  it("multiplies the raw value by scale to normalize onto the 0-1 range", () => {
    const csv = `${header}some-model,70.2,70.2\n`;
    const scores = extractScores(csv, "Best score (across scorers)", 0.01);
    expect(scores.get("some-model")?.value).toBeCloseTo(0.702);
  });
});

// ── epoch: benchmarkSaturation ───────────────────────────────────────────────

describe("benchmarkSaturation", () => {
  it("returns null when the benchmark has no ceiling", () => {
    expect(benchmarkSaturation({ score_ceiling: null }, [0.9, 0.95])).toBeNull();
  });

  it("returns null when there are no scores", () => {
    expect(benchmarkSaturation({ score_ceiling: 1.0 }, [])).toBeNull();
  });

  it("flags a field bunched near the ceiling as saturated", () => {
    const result = benchmarkSaturation({ score_ceiling: 1.0 }, [0.97, 0.98, 0.99, 0.5]);
    expect(result?.saturated).toBe(true);
    expect(result?.nearCeilingShare).toBeCloseTo(0.75);
  });

  it("does not flag a spread-out field as saturated", () => {
    const result = benchmarkSaturation({ score_ceiling: 1.0 }, [0.3, 0.5, 0.6, 0.2]);
    expect(result?.saturated).toBe(false);
  });
});

// ── eqbench ──────────────────────────────────────────────────────────────────

describe("extractEmbeddedCsv", () => {
  it("extracts the CSV, stopping at the first backtick after further JS/HTML follows", () => {
    const js = [
      "console.log('site boot');",
      "let leaderboardDataCreativeWritingV3 = `",
      "model_name,elo_score",
      "gpt-5.5,1500",
      "`;",
      "",
      "document.querySelector('.foo').innerHTML = `<div>not csv, has a backtick too\\`</div>`;",
    ].join("\n");

    expect(extractEmbeddedCsv(js, "leaderboardDataCreativeWritingV3")).toBe(
      "model_name,elo_score\ngpt-5.5,1500\n",
    );
  });

  it("returns null when the variable assignment is not present", () => {
    expect(
      extractEmbeddedCsv("let somethingElse = `a,b\n1,2`;", "leaderboardDataCreativeWritingV3"),
    ).toBeNull();
  });
});

const CREATIVE_WRITING_JS_FIXTURE = [
  "console.log('site boot');",
  "let leaderboardDataCreativeWritingV3 = `",
  "model_name,elo_score,creative_writing_score,avg_length,vocab_complexity,slop_score,repetition_score",
  "claude-sonnet-4-6,1550,8.5,3000,55.2,12.1,3.4",
  "*gpt-5.5,1490,8.1,2800,50.0,15.6,4.0",
  "some/totally-unknown-model,1400,7.0,2500,48.0,20.0,5.0",
  "`;",
  "",
  "document.querySelector('.foo').innerHTML = `<div>not csv</div>`;",
].join("\n");

const LONGFORM_JS_FIXTURE = [
  "let leaderboardDataLongformV3 = `",
  "model_name,overall_score_100,avg_chapter_length,vocab_complexity,slop_score,repetition_score,chapter1_avg,chapter2_avg,final_judgement_avg",
  "claude-sonnet-4-6,82.5,1200,60.0,10.0,2.0,8.0,8.2,8.4",
  "`;",
].join("\n");

describe("collectEqbench", () => {
  it("parses both leaderboards, strips a '*' new-entry marker, and records unmatched models", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(CREATIVE_WRITING_JS_FIXTURE))
      .mockResolvedValueOnce(textResponse(LONGFORM_JS_FIXTURE));

    const result = await collectEqbench(resolve);

    const elo = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "creative_writing_elo",
    );
    expect(elo?.value).toBe(1550);
    expect(elo?.source).toBe("eqbench");
    expect(elo?.confidence).toBe(0.8);

    // "*"-prefixed new-entry marker stripped before resolving
    const gptSlop = result.metrics.find(
      (m) => m.model_id === "gpt-5.5" && m.metric === "slop_score",
    );
    expect(gptSlop?.value).toBe(15.6);

    const longform = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "longform_writing",
    );
    expect(longform?.value).toBe(82.5);

    expect(result.unmatched.some((u) => u.externalId === "some/totally-unknown-model")).toBe(true);
  });

  it("skips a row whose cell count does not match the header", async () => {
    const ragged = [
      "let leaderboardDataCreativeWritingV3 = `",
      "model_name,elo_score,creative_writing_score,avg_length,vocab_complexity,slop_score,repetition_score",
      "claude-sonnet-4-6,1550,8.5,3000", // too few cells — ragged, must be skipped
      "`;",
    ].join("\n");
    fetchMock
      .mockResolvedValueOnce(textResponse(ragged))
      .mockResolvedValueOnce(textResponse("no literal here"));

    const result = await collectEqbench(resolve);
    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when the embedded CSV cannot be located in either file", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse("no literal here at all"))
      .mockResolvedValueOnce(textResponse("also nothing here"));

    const result = await collectEqbench(resolve);
    expect(result.metrics).toHaveLength(0);
  });
});

// ── lmarena ──────────────────────────────────────────────────────────────────

function categoryOf(url: string): string | null {
  const match = new URL(url).searchParams.get("where")?.match(/'([^']+)'/);
  return match?.[1] ?? null;
}

function arenaRow(overrides: { model_name: string; rating: number; vote_count?: number }): {
  row_idx: number;
  row: Record<string, unknown>;
} {
  return {
    row_idx: 0,
    row: {
      model_name: overrides.model_name,
      organization: "anthropic",
      license: "Proprietary",
      rating: overrides.rating,
      rating_lower: overrides.rating - 10,
      rating_upper: overrides.rating + 10,
      variance: 5,
      vote_count: overrides.vote_count ?? 1000,
      rank: 1,
      category: "overall",
      leaderboard_publish_date: "2026-09-01",
    },
  };
}

describe("collectLmarena", () => {
  const resolveArena = createIdResolver(["claude-sonnet-4-6", "claude-opus-4-6"]);

  it("paginates a category until num_rows_total is covered", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const category = categoryOf(String(input));
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      if (category !== "overall") return jsonResponse({ rows: [], num_rows_total: 0 });
      if (offset === 0) {
        return jsonResponse({
          rows: [arenaRow({ model_name: "claude-sonnet-4-6", rating: 1500 })],
          num_rows_total: 150,
        });
      }
      return jsonResponse({
        rows: [arenaRow({ model_name: "claude-opus-4-6", rating: 1600 })],
        num_rows_total: 150,
      });
    });

    vi.useFakeTimers();
    const promise = collectLmarena(resolveArena);
    await vi.runAllTimersAsync(); // the inter-page delay
    const result = await promise;
    vi.useRealTimers();

    const overall = result.metrics.filter((m) => m.metric === "arena_elo");
    expect(overall.map((m) => m.model_id).toSorted()).toEqual([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
    // high vote_count (default 1000) — high-confidence tier
    expect(overall.find((m) => m.model_id === "claude-sonnet-4-6")?.confidence).toBe(0.85);
  });

  it("retries the 'index is loading' error, then skips just that category", async () => {
    vi.useFakeTimers();
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      return jsonResponse({
        error: "the dataset index is loading, this may take longer than usual",
      });
    });

    const promise = collectLmarena(resolveArena);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.metrics).toHaveLength(0);
    // 5 categories x (initial attempt + two retries) = 15 fetch calls. The first
    // page never succeeds, so num_rows_total stays unknown and each category
    // stops after that one page instead of paging forever.
    expect(calls).toBe(15);
    vi.useRealTimers();
  });

  it("keeps the pages that succeeded when a later page fails", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const category = categoryOf(String(input));
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      if (category !== "overall") return jsonResponse({ rows: [], num_rows_total: 0 });
      if (offset === 0) {
        return jsonResponse({
          rows: [arenaRow({ model_name: "claude-sonnet-4-6", rating: 1500 })],
          num_rows_total: 150,
        });
      }
      return jsonResponse({ error: "the dataset index is loading" });
    });

    const promise = collectLmarena(resolveArena);
    await vi.runAllTimersAsync();
    const result = await promise;

    // The second page is lost; the first page's model survives rather than the
    // whole category being discarded.
    expect(result.metrics.filter((m) => m.metric === "arena_elo").map((m) => m.model_id)).toEqual([
      "claude-sonnet-4-6",
    ]);
    vi.useRealTimers();
  });

  it("resolves a hyphenated effort suffix, keeping the higher-rated variant", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const category = categoryOf(String(input));
      if (category !== "creative_writing") return jsonResponse({ rows: [], num_rows_total: 0 });
      return jsonResponse({
        rows: [
          arenaRow({ model_name: "claude-opus-4-6", rating: 1484.3 }),
          arenaRow({ model_name: "claude-opus-4-6-high", rating: 1504.7 }),
        ],
        num_rows_total: 2,
      });
    });

    const result = await collectLmarena(resolveArena);
    const cw = result.metrics.filter((m) => m.metric === "arena_creative_writing");
    expect(cw).toHaveLength(1);
    expect(cw[0]?.model_id).toBe("claude-opus-4-6");
    expect(cw[0]?.value).toBe(1504.7);
    expect(result.unmatched).toHaveLength(0);
  });

  it("leaves a genuine -max model name intact when it resolves directly", async () => {
    const resolveMax = createIdResolver(["qwen3.8-max"]);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const category = categoryOf(String(input));
      if (category !== "overall") return jsonResponse({ rows: [], num_rows_total: 0 });
      return jsonResponse({
        rows: [arenaRow({ model_name: "qwen3.8-max", rating: 1470 })],
        num_rows_total: 1,
      });
    });

    const result = await collectLmarena(resolveMax);
    expect(result.metrics.filter((m) => m.metric === "arena_elo")[0]?.model_id).toBe("qwen3.8-max");
  });

  it("drops rows below the vote_count floor and lowers confidence under the high-confidence threshold", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const category = categoryOf(String(input));
      if (category !== "overall") return jsonResponse({ rows: [], num_rows_total: 0 });
      return jsonResponse({
        rows: [
          arenaRow({ model_name: "claude-sonnet-4-6", rating: 1500, vote_count: 50 }), // below floor
          arenaRow({ model_name: "claude-opus-4-6", rating: 1600, vote_count: 200 }), // low confidence
        ],
        num_rows_total: 2,
      });
    });

    const result = await collectLmarena(resolveArena);
    const metrics = result.metrics.filter((m) => m.metric === "arena_elo");
    expect(metrics.find((m) => m.model_id === "claude-sonnet-4-6")).toBeUndefined();
    expect(metrics.find((m) => m.model_id === "claude-opus-4-6")?.confidence).toBe(0.7);
  });
});
