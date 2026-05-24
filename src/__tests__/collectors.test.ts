import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveModelId } from "../server/collectors/normalize.js";
import { collectOpenRouter } from "../server/collectors/openrouter.js";
import { collectArtificialAnalysis } from "../server/collectors/artificialanalysis.js";

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

// ── resolveModelId ─────────────────────────────────────────────────────────────

describe("resolveModelId", () => {
  it("returns exact match for a known local ID", () => {
    expect(resolveModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips provider prefix for OpenRouter-style IDs", () => {
    expect(resolveModelId("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips provider prefix for a different provider", () => {
    expect(resolveModelId("openai/gpt-5.5")).toBe("gpt-5.5");
  });

  it("returns null for unknown external ID", () => {
    expect(resolveModelId("some/unknown-model-xyz-9000")).toBeNull();
  });

  it("handles fuzzy case-insensitive match", () => {
    // "claude-sonnet-4-6" normalised = "claude-sonnet-4-6" — should still match
    expect(resolveModelId("Claude-Sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("returns exact match for TTS model", () => {
    expect(resolveModelId("tts-hd")).toBe("tts-hd");
  });

  it("returns exact match for STT model", () => {
    expect(resolveModelId("whisper")).toBe("whisper");
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
    },
    {
      id: "openai/gpt-5.5",
      name: "OpenAI: GPT-5.5",
      context_length: 128000,
      pricing: { prompt: "0.000005", completion: "0.000020" },
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

    const result = await collectOpenRouter();

    // claude-sonnet-4-6 and gpt-5.5 both match → 3 metrics each = 6 total
    expect(result.metrics).toHaveLength(6);

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
    const result = await collectOpenRouter();

    const priceOut = result.metrics.find(
      (m) => m.model_id === "gpt-5.5" && m.metric === "price_out",
    );
    // 0.000020 × 1_000_000 = 20.0
    expect(priceOut?.value).toBeCloseTo(20.0);
  });

  it("captures context_window metric", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter();

    const ctx = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "context_window",
    );
    expect(ctx?.value).toBe(200000);
  });

  it("records unmatched external models separately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    const result = await collectOpenRouter();

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.externalId).toBe("some/totally-unknown-model");
  });

  it("returns empty result on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403));
    const result = await collectOpenRouter();

    expect(result.metrics).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it("returns empty result on fetch throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const result = await collectOpenRouter();

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when API key is missing", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    const result = await collectOpenRouter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics).toHaveLength(0);
  });

  it("sets Authorization header with the API key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OR_FIXTURE));
    await collectOpenRouter();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-or-key");
  });
});

// ── collectArtificialAnalysis ──────────────────────────────────────────────────

const AA_FIXTURE_ARRAY: unknown[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    evaluations: {
      artificial_analysis_intelligence_index: 78.5,
      artificial_analysis_coding_index: 82.0,
    },
    pricing: {
      price_1m_input_tokens: 3.0,
      price_1m_output_tokens: 15.0,
    },
    median_output_tokens_per_second: 95.2,
    median_time_to_first_token_seconds: 0.42,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    evaluations: {
      artificial_analysis_intelligence_index: 85.0,
    },
    pricing: null,
    median_output_tokens_per_second: null,
    median_time_to_first_token_seconds: 0.31,
  },
  {
    id: "completely-unknown-model-abc",
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
    const result = await collectArtificialAnalysis();

    // claude-sonnet-4-6: quality + throughput + latency_p50 + price_in + price_out = 5
    // gpt-5.5: quality + latency_p50 = 2
    expect(result.metrics.length).toBe(7);
  });

  it("maps quality metric from intelligence_index", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis();

    const quality = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "quality",
    );
    expect(quality?.value).toBeCloseTo(78.5);
    expect(quality?.source).toBe("artificialanalysis");
    expect(quality?.confidence).toBe(0.9);
  });

  it("maps throughput from median_output_tokens_per_second", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis();

    const throughput = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "throughput",
    );
    expect(throughput?.value).toBeCloseTo(95.2);
  });

  it("maps latency_p50 from median_time_to_first_token_seconds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis();

    const latency = result.metrics.find(
      (m) => m.model_id === "claude-sonnet-4-6" && m.metric === "latency_p50",
    );
    expect(latency?.value).toBeCloseTo(0.42);
  });

  it("skips null metric values gracefully", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis();

    // gpt-5.5 has null pricing and null throughput — should not appear
    const gptMetrics = result.metrics.filter((m) => m.model_id === "gpt-5.5");
    const metricNames = gptMetrics.map((m) => m.metric);
    expect(metricNames).not.toContain("price_in");
    expect(metricNames).not.toContain("price_out");
    expect(metricNames).not.toContain("throughput");
  });

  it("records unmatched external model IDs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    const result = await collectArtificialAnalysis();

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.externalId).toBe("completely-unknown-model-abc");
  });
});

describe("collectArtificialAnalysis — wrapped object response", () => {
  it("extracts models from { models: [] } wrapper", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_WRAPPED));
    const result = await collectArtificialAnalysis();

    expect(result.metrics.length).toBeGreaterThan(0);
  });
});

describe("collectArtificialAnalysis — error handling", () => {
  it("returns empty result on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const result = await collectArtificialAnalysis();

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result on fetch throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const result = await collectArtificialAnalysis();

    expect(result.metrics).toHaveLength(0);
  });

  it("returns empty result when API key is missing", async () => {
    delete process.env["ARTIFICIALANALYSIS_API_KEY"];
    const result = await collectArtificialAnalysis();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics).toHaveLength(0);
  });

  it("sets x-api-key header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(AA_FIXTURE_ARRAY));
    await collectArtificialAnalysis();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("x-api-key")).toBe("test-aa-key");
  });
});
