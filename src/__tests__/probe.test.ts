import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseResidency, IuFetchError, iuFetch } from "../server/iu/client.js";
import { probeModel } from "../server/iu/probe.js";

// Replace global fetch with a Vitest mock
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeFetchResponse(
  status: number,
  body: unknown,
  responseHeaders: Record<string, string> = {},
  isAudio = false,
): Response {
  const contentType = isAudio ? "audio/mpeg" : "application/json";
  const headers = new Headers({ "content-type": contentType, ...responseHeaders });
  return {
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_OPENAI_BASE_URL"] = "https://iu-test.example/openai/v1";
  process.env["IU_API_KEY"] = "test-key";
});

afterEach(() => {
  vi.useRealTimers();
});

// ── parseResidency ──────────────────────────────────────────────────────────

describe("parseResidency", () => {
  it("returns eu when x-ms-region contains Sweden", () => {
    const h = new Headers({ "x-ms-region": "Sweden Central" });
    expect(parseResidency(h)).toBe("eu");
  });

  it("returns eu when x-middleware-forwarded-server contains Sweden", () => {
    const h = new Headers({
      "x-middleware-forwarded-server": "IU AI Middleware Sweden Central Azure",
    });
    expect(parseResidency(h)).toBe("eu");
  });

  it("returns us when x-middleware-forwarded-server contains OpenAI Vendor", () => {
    const h = new Headers({
      "x-middleware-forwarded-server": "OpenAI Vendor Group Key",
    });
    expect(parseResidency(h)).toBe("us");
  });

  it("returns unknown when no relevant headers present", () => {
    const h = new Headers({ "x-request-id": "abc123" });
    expect(parseResidency(h)).toBe("unknown");
  });
});

// ── iuFetch retry ────────────────────────────────────────────────────────────

describe("iuFetch", () => {
  it("sets Authorization header on every request", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { choices: [] }),
    );

    await iuFetch("/chat/completions", { method: "POST" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentHeaders = new Headers(init.headers as HeadersInit);
    expect(sentHeaders.get("Authorization")).toBe("Bearer test-key");
  });

  it("retries on 503 and succeeds on second attempt", async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(503, { error: "overloaded" }))
      .mockResolvedValueOnce(makeFetchResponse(200, { choices: [] }));

    const resultPromise = iuFetch("/chat/completions");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it("throws IuFetchError after all attempts return 503", async () => {
    vi.useFakeTimers();

    fetchMock.mockResolvedValue(makeFetchResponse(503, { error: "overloaded" }));

    const resultPromise = iuFetch("/chat/completions");
    // Attach the rejection handler BEFORE advancing timers to avoid
    // UnhandledPromiseRejection warnings (rejection fires when timers run).
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(IuFetchError);

    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS = 3
  });

  it("returns non-503 error responses immediately without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(410, { error: { message: "Model deprecated" } }),
    );

    const result = await iuFetch("/chat/completions");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(410);
  });
});

// ── probeModel ───────────────────────────────────────────────────────────────

describe("probeModel — LLM", () => {
  it("marks accessible=true and captures residency on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(
        200,
        { choices: [{ message: { content: "hi" } }] },
        { "x-ms-region": "Sweden Central" },
      ),
    );

    const result = await probeModel("claude-sonnet-4-6", "llm");

    expect(result.accessible).toBe(true);
    expect(result.residency).toBe("eu");
    expect(result.latency_ms).toBeTypeOf("number");
    expect(result.error).toBeUndefined();
  });

  it("marks accessible=false on 410 (deprecated model)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(410, { error: { message: "Model deprecated" } }),
    );

    const result = await probeModel("gpt-5.5", "llm");

    expect(result.accessible).toBe(false);
    expect(result.model_id).toBe("gpt-5.5");
  });

  it("marks accessible=false and sets error when fetch throws", async () => {
    vi.useFakeTimers();

    // All 3 attempts return 503 → IuFetchError caught by probeModel
    fetchMock.mockResolvedValue(makeFetchResponse(503, {}));

    // probeModel catches the IuFetchError internally, so the promise resolves
    const resultPromise = probeModel("gpt-5.5", "llm");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.accessible).toBe(false);
    expect(result.error).toContain("503");
  });
});

describe("probeModel — TTS", () => {
  it("marks accessible=true on 200 audio response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, new ArrayBuffer(512), {}, true),
    );

    const result = await probeModel("tts-hd", "tts");

    expect(result.accessible).toBe(true);
    expect(result.modality).toBe("tts");
  });

  it("marks accessible=false on 400", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(400, { error: { message: "invalid voice" } }),
    );

    const result = await probeModel("voxtral-mini-tts", "tts");

    expect(result.accessible).toBe(false);
  });
});

describe("probeModel — STT", () => {
  it("marks accessible=true on 200 transcription response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { text: "" }),
    );

    const result = await probeModel("whisper", "stt");

    expect(result.accessible).toBe(true);
    expect(result.modality).toBe("stt");
  });

  it("sends multipart/form-data with .mp3 filename", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, { text: "" }));

    await probeModel("whisper", "stt");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.mp3");
    expect(file.type).toBe("audio/mpeg");
  });
});
