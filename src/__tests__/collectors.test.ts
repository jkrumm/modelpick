import { describe, it, expect, vi, beforeEach } from "vitest";
import { compareVersions, createIdResolver, versionOf } from "../server/collectors/normalize.js";
import { collectOpenRouter } from "../server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../server/collectors/artificialanalysis.js";

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
