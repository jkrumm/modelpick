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
import { collectModelsDev } from "../server/collectors/modelsdev.js";
import { collectArtificialAnalysisSpeech } from "../server/collectors/artificialanalysis-speech.js";
import { arenaDisplayToSlug, collectLmarena } from "../server/collectors/lmarena.js";

const resolve = createIdResolver([
  "claude-sonnet-4-6",
  "gpt-5.5",
  "tts-hd",
  "whisper",
  "gpt-4o-mini-transcribe",
]);

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
    expect(versionOf("gemini-3.5-flash")).toEqual({
      family: "gemini-flash",
      version: "3.5",
    });
  });

  it("splits a dashed multi-segment version", () => {
    expect(versionOf("GLM-5.3")).toEqual({ family: "glm", version: "5.3" });
    expect(versionOf("claude-opus-4-8")).toEqual({
      family: "claude-opus",
      version: "4.8",
    });
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

const AA_MODELS: unknown[] = [
  {
    id: "c99f3bde-7c08-4de8-bd5c-8ee9123ebffa",
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    evaluations: {
      artificial_analysis_intelligence_index: 78.5,
      artificial_analysis_coding_index: 82.0,
    },
    pricing: {
      price_1m_input_tokens: 3.0,
      price_1m_output_tokens: 15.0,
    },
    performance: {
      median_output_tokens_per_second: 95.2,
      median_time_to_first_token_seconds: 0.42,
    },
  },
  {
    id: "f0083258-8646-45b8-8082-7aaf6c2ea82a",
    slug: "gpt-5-5",
    name: "GPT-5.5",
    evaluations: {
      artificial_analysis_intelligence_index: 85.0,
      artificial_analysis_coding_index: null,
    },
    pricing: null,
    performance: {
      median_output_tokens_per_second: null,
      median_time_to_first_token_seconds: 0.31,
    },
  },
  {
    id: "16149b9c-a1e9-4669-a5cb-ff3c00d78f89",
    slug: "completely-unknown-model-abc",
    name: "Unknown Model",
    evaluations: { artificial_analysis_intelligence_index: 60.0 },
    pricing: null,
    performance: null,
  },
];

function aaPage(data: unknown[], hasMore: boolean): unknown {
  return {
    tier: "free",
    data,
    pagination: { page: 1, page_size: 200, total_pages: 1, has_more: hasMore },
  };
}

const AA_SINGLE_PAGE = aaPage(AA_MODELS, false);

describe("collectArtificialAnalysis — free language endpoint", () => {
  it("maps quality, coding_index, throughput, latency_p50, price_in, price_out", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
    const result = await collectArtificialAnalysis(resolve);

    // claude-sonnet-4-6: all six; gpt-5.5: quality + latency_p50
    expect(result.metrics.length).toBe(8);
  });

  it("maps quality metric from intelligence_index", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
    const result = await collectArtificialAnalysis(resolve);

    const quality = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "quality",
    );
    expect(quality?.value).toBeCloseTo(78.5);
    expect(quality?.source).toBe("artificialanalysis");
    expect(quality?.confidence).toBe(0.9);
  });

  it("maps coding_index metric from coding_index", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
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

  it("reads speed from the performance object", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
    const result = await collectArtificialAnalysis(resolve);

    const byMetric = new Map(
      result.metrics
        .filter((m) => m.model_id === "claude-sonnet-4-6")
        .map((m) => [m.metric, m.value]),
    );
    expect(byMetric.get("throughput")).toBeCloseTo(95.2);
    expect(byMetric.get("latency_p50")).toBeCloseTo(0.42);
  });

  it("skips null metric values gracefully — missing must not become zero", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
    const result = await collectArtificialAnalysis(resolve);

    // gpt-5.5 has null pricing and null throughput — should not appear
    const metricNames = result.metrics.filter((m) => m.model_id === "gpt-5.5").map((m) => m.metric);
    expect(metricNames).not.toContain("price_in");
    expect(metricNames).not.toContain("price_out");
    expect(metricNames).not.toContain("throughput");
  });

  it("records unmatched external model IDs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.externalId).toBe("completely-unknown-model-abc");
  });

  it("follows pagination until has_more is false", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(aaPage(AA_MODELS.slice(0, 1), true)))
      .mockResolvedValueOnce(jsonResponse(aaPage(AA_MODELS.slice(1), false)));
    const result = await collectArtificialAnalysis(resolve);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("/api/v2/language/models/free?page=1");
    expect(urls[1]).toContain("page=2");
    expect(result.metrics.length).toBe(8);
  });

  it("takes a pinned id's scores from its pinned snapshot, never the undated slug", async () => {
    const snapshot = (slug: string, quality: number): unknown => ({
      id: slug,
      slug,
      name: slug,
      evaluations: { artificial_analysis_intelligence_index: quality },
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        aaPage(
          [snapshot("deepseek-v4-1-flash", 39.5), snapshot("deepseek-v4-1-flash-1017", 45.1)],
          false,
        ),
      ),
    );
    const result = await collectArtificialAnalysis(createIdResolver(["deepseek-v4.1-flash"]));

    const quality = result.metrics.filter(
      (m) => m.model_id === "deepseek-v4.1-flash" && m.metric === "quality",
    );
    expect(quality.map((m) => m.value)).toEqual([45.1]);
    expect(result.unmatched).toHaveLength(0);
  });
});

describe("collectArtificialAnalysis — error handling", () => {
  it("returns empty result on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const result = await collectArtificialAnalysis(resolve);

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when a later page fails — never a partial pull", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(aaPage(AA_MODELS, true)))
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
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
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_SINGLE_PAGE));
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

  it("retries the 'index is loading' error on /filter, falls back to /rows, and yields nothing when both stay down", async () => {
    vi.useFakeTimers();
    let filterCalls = 0;
    let rowsCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/rows") rowsCalls++;
      else filterCalls++;
      return jsonResponse({
        error: "the dataset index is loading, this may take longer than usual",
      });
    });

    const promise = collectLmarena(resolveArena);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.metrics).toHaveLength(0);
    // The first /filter page never succeeds (initial attempt + two retries), so
    // the collector switches to /rows once instead of retrying every category.
    expect(filterCalls).toBe(3);
    expect(rowsCalls).toBe(3);
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

  describe("/rows fallback", () => {
    const fixtureRows = [
      { model_name: "claude-sonnet-4-6", rating: 1500, category: "overall" },
      { model_name: "claude-opus-4-6", rating: 1600, category: "overall" },
      { model_name: "claude-opus-4-6-high", rating: 1650, category: "creative_writing" },
      { model_name: "claude-sonnet-4-6", rating: 1400, category: "german", vote_count: 200 },
      { model_name: "claude-opus-4-6", rating: 1300, category: "coding", vote_count: 50 },
      { model_name: "unknown-model", rating: 1200, category: "overall" },
    ].map((r) => {
      const base = arenaRow(r);
      return { ...base, row: { ...base.row, category: r.category } };
    });

    // Real pages hold 100 rows; two per page here with a 250-row total makes the
    // loop walk three pages (the rest of the fixture split is empty).
    function pageOf(page: number): { rows: unknown[]; num_rows_total: number } {
      return { rows: fixtureRows.slice(page * 2, page * 2 + 2), num_rows_total: 250 };
    }

    async function run(
      handler: (url: URL) => Response | Promise<Response>,
    ): Promise<Awaited<ReturnType<typeof collectLmarena>>> {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
        handler(new URL(String(input))),
      );
      const promise = collectLmarena(resolveArena);
      await vi.runAllTimersAsync();
      const result = await promise;
      vi.useRealTimers();
      return result;
    }

    const filterHandler = (url: URL): Response => {
      const category = categoryOf(url.toString());
      const offset = Number(url.searchParams.get("offset"));
      const matching = fixtureRows.filter((r) => r.row.category === category);
      return jsonResponse({
        rows: matching.slice(offset, offset + 100),
        num_rows_total: matching.length,
      });
    };

    it("produces the same metrics as the /filter path when /filter returns 500", async () => {
      const viaFilter = await run(filterHandler);
      const viaRows = await run((url) => {
        if (url.pathname === "/filter") return new Response("auth check failed", { status: 500 });
        return jsonResponse(pageOf(Number(url.searchParams.get("offset")) / 100));
      });

      expect(viaFilter.metrics.length).toBeGreaterThan(0);
      const key = (m: { metric: string; model_id: string }): string => `${m.metric}/${m.model_id}`;
      expect(viaRows.metrics.toSorted((a, b) => key(a).localeCompare(key(b)))).toEqual(
        viaFilter.metrics.toSorted((a, b) => key(a).localeCompare(key(b))),
      );
      expect(viaRows.unmatched).toEqual(viaFilter.unmatched);
    });

    it("keeps the /rows pages already fetched when a later page fails", async () => {
      const result = await run((url) => {
        if (url.pathname === "/filter") return new Response("auth check failed", { status: 500 });
        const page = Number(url.searchParams.get("offset")) / 100;
        if (page >= 1) return new Response("boom", { status: 500 });
        return jsonResponse({ rows: fixtureRows.slice(0, 3), num_rows_total: 250 });
      });

      // page 0 survives (overall: sonnet + opus + unknown, creative_writing: opus-high)
      expect(
        result.metrics
          .filter((m) => m.metric === "arena_elo")
          .map((m) => m.model_id)
          .toSorted(),
      ).toEqual(["claude-opus-4-6", "claude-sonnet-4-6"]);
      expect(result.metrics.filter((m) => m.metric === "arena_creative_writing")).toHaveLength(1);
    });
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
          arenaRow({
            model_name: "claude-sonnet-4-6",
            rating: 1500,
            vote_count: 50,
          }), // below floor
          arenaRow({
            model_name: "claude-opus-4-6",
            rating: 1600,
            vote_count: 200,
          }), // low confidence
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

// ── modelsdev ────────────────────────────────────────────────────────────────

const MODELS_DEV_FIXTURE = {
  openai: {
    models: {
      "gpt-5.5": {
        id: "gpt-5.5",
        name: "GPT-5.5",
        canonical_model_id: "openai/gpt-5.5",
        cost: { input: 1.25, output: 10, cache_read: 0.125 },
        limit: { context: 400000 },
      },
    },
  },
  reseller: {
    models: {
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        canonical_model_id: "openai/gpt-5.5",
        cost: { input: 9, output: 99 },
      },
      "whisper": { id: "whisper", name: "Whisper", cost: { input: 0.006, output: 0 } },
    },
  },
  anthropic: {
    models: {
      "claude-never-heard-of": {
        id: "claude-never-heard-of",
        name: "Unknown",
        canonical_model_id: "anthropic/claude-never-heard-of",
        cost: { input: 1, output: 2 },
      },
    },
  },
};

describe("collectModelsDev", () => {
  it("takes the first-party row over resellers and emits list price, cache and context", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(MODELS_DEV_FIXTURE));
    const result = await collectModelsDev(resolve);
    const gpt = result.metrics.filter((m) => m.model_id === "gpt-5.5");
    const byMetric = Object.fromEntries(gpt.map((m) => [m.metric, m]));
    expect(byMetric["price_in"]?.value).toBe(1.25);
    expect(byMetric["price_out"]?.value).toBe(10);
    expect(byMetric["price_cache_read"]?.value).toBe(0.125);
    expect(byMetric["context_window"]?.value).toBe(400000);
    expect(byMetric["price_in"]?.source).toBe("modelsdev");
    expect(byMetric["price_in"]?.confidence).toBe(0.95);
  });

  it("drops zero prices and reports only first-party unmatched ids", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(MODELS_DEV_FIXTURE));
    const result = await collectModelsDev(resolve);
    const whisper = result.metrics.filter((m) => m.model_id === "whisper");
    expect(whisper.map((m) => m.metric)).toEqual(["price_in"]);
    expect(result.unmatched.map((u) => u.externalId)).toEqual(["anthropic/claude-never-heard-of"]);
  });

  it("returns empty on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    expect(await collectModelsDev(resolve)).toEqual({ metrics: [], unmatched: [] });
  });
});

// ── artificialanalysis speech ────────────────────────────────────────────────

describe("collectArtificialAnalysisSpeech", () => {
  it("emits tts_elo and stt_wer_index, skips null WER, strips the STT vendor suffix", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: "TTS HD", slug: "tts-hd", elo: 1200, ci_95: 10 }],
          pagination: { has_more: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: "Whisper, OpenAI", aa_wer_index: 0.06 },
            { name: "GPT-4o Mini Transcribe, OpenAI", aa_wer_index: 0.045 },
            { name: "WhisperX", aa_wer_index: null },
          ],
        }),
      );
    const result = await collectArtificialAnalysisSpeech(resolve);
    const tts = result.metrics.find((m) => m.metric === "tts_elo");
    const stt = result.metrics.find((m) => m.metric === "stt_wer_index");
    expect(tts).toMatchObject({ model_id: "tts-hd", value: 1200, source: "artificialanalysis" });
    expect(stt).toMatchObject({ model_id: "whisper", value: 0.06 });
    expect(
      result.metrics.find((m) => m.model_id === "gpt-4o-mini-transcribe"),
    ).toMatchObject({ metric: "stt_wer_index", value: 0.045 });
    expect(result.metrics).toHaveLength(3);
    expect(result.unmatched).toEqual([]);
  });

  it("keeps the other leg when one endpoint fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: "Whisper, OpenAI", aa_wer_index: 0.06 }] }));
    const result = await collectArtificialAnalysisSpeech(resolve);
    expect(result.metrics.map((m) => m.metric)).toEqual(["stt_wer_index"]);
  });

  it("skips without an API key", async () => {
    delete process.env["ARTIFICIALANALYSIS_API_KEY"];
    expect(await collectArtificialAnalysisSpeech(resolve)).toEqual({ metrics: [], unmatched: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("arenaDisplayToSlug", () => {
  it.each([
    ["Claude Opus 5.5 (High)", "claude-opus-5.5"],
    ["Claude Sonnet 4.5 (High, 32K, 20250929)", "claude-sonnet-4.5"],
    ["GPT-5.2 Chat (20260210)", "gpt-5.2-chat"],
    ["Gemini 3.5 Flash-Lite", "gemini-3.5-flash-lite"],
  ])("%s -> %s", (name, slug) => {
    expect(arenaDisplayToSlug(name)).toBe(slug);
  });

  it("lets a display-name row resolve to a catalog id", async () => {
    const resolveOpus = createIdResolver(["claude-opus-5-5"]);
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        rows: [
          { row: { model_name: "Claude Opus 5.5 (High)", rating: 1516, vote_count: 900 } },
          { row: { model_name: "Claude Opus 5.5 (Max)", rating: 1520, vote_count: 900 } },
        ],
        num_rows_total: 2,
      }),
    );
    const result = await collectLmarena(resolveOpus);
    const elo = result.metrics.find((m) => m.metric === "arena_elo");
    expect(elo).toMatchObject({ model_id: "claude-opus-5-5", value: 1520 });
  });
});
