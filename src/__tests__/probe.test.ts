import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseResidency, IuFetchError, iuFetch, gatewayChat } from "../server/iu/client.js";
import { classifyProbe, isAccessible } from "../server/iu/classify.js";
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
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers,
    json: async () => body,
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_OPENAI_BASE_URL"] = "https://iu-test.example/openai/v1";
  process.env["IU_ANTHROPIC_BASE_URL"] = "https://iu-test.example/anthropic/v1";
  process.env["IU_GEMINI_BASE_URL"] = "https://iu-test.example/gemini/v1beta";
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
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, { choices: [] }));

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

// ── classifyProbe ─────────────────────────────────────────────────────────────

describe("classifyProbe", () => {
  it("classifies 2xx as available with no error", () => {
    expect(classifyProbe({ status: 200, body: "{}" })).toEqual({
      status: "available",
      error: null,
    });
  });

  it("classifies timeout", () => {
    expect(classifyProbe({ status: "timeout", body: "TimeoutError" }).status).toBe("timeout");
  });

  it("classifies usage-limit bodies as throttled", () => {
    const body =
      '{"error":{"message":"You have reached your specified API usage limits. You will regain access on 2026-06-01."}}';
    expect(classifyProbe({ status: 417, body }).status).toBe("throttled");
  });

  it("treats a request-shape param quibble as available (route reached the model)", () => {
    const body =
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    expect(classifyProbe({ status: 400, body }).status).toBe("available");
  });

  it("classifies an upstream bad-key as backend_error", () => {
    const body = '{"error":{"message":"Incorrect API key provided: sk-DAINR..."}}';
    expect(classifyProbe({ status: 417, body }).status).toBe("backend_error");
  });

  it("classifies missing auth header as backend_error", () => {
    const body = '{"error":{"message":"Missing or invalid Authorization header."}}';
    expect(classifyProbe({ status: 417, body }).status).toBe("backend_error");
  });

  it("classifies 'no providers available' as not_routed", () => {
    const body = "NO first line providers available for model";
    expect(classifyProbe({ status: 406, body }).status).toBe("not_routed");
  });

  it("classifies 'no suitable backend' as not_routed", () => {
    const body = "No suitable backend server found for model 'tts-1'.";
    expect(classifyProbe({ status: 404, body }).status).toBe("not_routed");
  });

  it("classifies a Vertex not-found/no-access as not_routed", () => {
    const body = "Publisher Model ... was not found or your project does not have access to it.";
    expect(classifyProbe({ status: 417, body }).status).toBe("not_routed");
  });

  it("classifies 'does not exist' (Nebius) as not_routed", () => {
    const body =
      '[Nebius AI Cloud StatusCode: NotFound] {"detail":"The model `Qwen/QwQ-32B-fast` does not exist."}';
    expect(classifyProbe({ status: 503, body }).status).toBe("not_routed");
  });

  it("classifies a bare 'StatusCode: NotFound' gateway tag as not_routed", () => {
    const body = "[Gemini API OpenAI direct StatusCode: NotFound]";
    expect(classifyProbe({ status: 503, body }).status).toBe("not_routed");
  });

  it("classifies 'not a chat model' as not_routed", () => {
    const body = '{"error":{"message":"This is not a chat model and thus not supported"}}';
    expect(classifyProbe({ status: 404, body }).status).toBe("not_routed");
  });

  it("classifies a wrong-payload-shape error as bad_request", () => {
    const body =
      '[{ "error": { "message": "Invalid JSON payload received. Unknown name \\"input\\": Cannot find field." } }]';
    expect(classifyProbe({ status: 417, body }).status).toBe("bad_request");
  });

  it("falls back to unknown for unrecognized non-2xx", () => {
    const result = classifyProbe({ status: 500, body: "internal blip" });
    expect(result.status).toBe("unknown");
    expect(result.error).toContain("internal blip");
  });

  it("isAccessible includes available and throttled only", () => {
    expect(isAccessible("available")).toBe(true);
    expect(isAccessible("throttled")).toBe(true);
    expect(isAccessible("backend_error")).toBe(false);
    expect(isAccessible("not_routed")).toBe(false);
    expect(isAccessible("bad_request")).toBe(false);
    expect(isAccessible("timeout")).toBe(false);
    expect(isAccessible("unknown")).toBe(false);
  });
});

// ── gatewayChat (provider-native routing) ─────────────────────────────────────

describe("gatewayChat", () => {
  it("routes anthropic to /messages with the version header and parses content", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { content: [{ type: "text", text: "Hello" }] }),
    );

    const res = await gatewayChat({
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      prompt: "hi",
      maxTokens: 4,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://iu-test.example/anthropic/v1/messages");
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(init.body as string)).toMatchObject({ max_tokens: 4 });
    expect(res.text).toBe("Hello");
  });

  it("routes google to :generateContent and parses candidates", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, {
        candidates: [{ content: { parts: [{ text: "Hi there" }] } }],
      }),
    );

    const res = await gatewayChat({
      model: "gemini-2.5-flash",
      provider: "google",
      prompt: "hi",
      maxTokens: 4,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://iu-test.example/gemini/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: { maxOutputTokens: 4 },
    });
    expect(res.text).toBe("Hi there");
  });

  it("routes openai to /chat/completions with max_completion_tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { choices: [{ message: { content: "Hey" } }] }),
    );

    const res = await gatewayChat({
      model: "gpt-5.1",
      provider: "openai",
      prompt: "hi",
      maxTokens: 4,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://iu-test.example/openai/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({ max_completion_tokens: 4 });
    expect(res.text).toBe("Hey");
  });
});

// ── probeModel ───────────────────────────────────────────────────────────────

describe("probeModel — LLM", () => {
  it("marks available + captures residency on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { content: [{ text: "hi" }] }, { "x-ms-region": "Sweden Central" }),
    );

    const result = await probeModel({
      model_id: "claude-sonnet-4-5",
      modality: "llm",
      provider: "anthropic",
    });

    expect(result.accessible).toBe(true);
    expect(result.probe_status).toBe("available");
    expect(result.residency).toBe("eu");
    expect(result.latency_ms).toBeTypeOf("number");
    expect(result.error).toBeNull();
  });

  it("marks throttled as accessible with a persisted reason", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(417, {
        error: { message: "You have reached your specified API usage limits." },
      }),
    );

    const result = await probeModel({
      model_id: "claude-opus-4-5",
      modality: "llm",
      provider: "anthropic",
    });

    expect(result.probe_status).toBe("throttled");
    expect(result.accessible).toBe(true);
    expect(result.error).toContain("usage limits");
  });

  it("marks an upstream bad key as backend_error (not accessible)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(417, {
        error: { message: "Incorrect API key provided: sk-DAINR..." },
      }),
    );

    const result = await probeModel({
      model_id: "gpt-5.1",
      modality: "llm",
      provider: "openai",
    });

    expect(result.probe_status).toBe("backend_error");
    expect(result.accessible).toBe(false);
  });
});

describe("probeModel — TTS", () => {
  it("marks available on 200 audio response", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, new ArrayBuffer(512), {}, true));

    const result = await probeModel({ model_id: "tts-hd", modality: "tts", provider: "openai" });

    expect(result.accessible).toBe(true);
    expect(result.modality).toBe("tts");
  });

  it("marks not_routed when no backend serves the model", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(404, "No suitable backend server found for model 'tts-1'."),
    );

    const result = await probeModel({ model_id: "tts-1", modality: "tts", provider: "openai" });

    expect(result.accessible).toBe(false);
    expect(result.probe_status).toBe("not_routed");
  });

  it("routes Gemini TTS to native generateContent with an AUDIO response modality", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, {
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: "AA" } }] } },
        ],
      }),
    );

    const result = await probeModel({
      model_id: "gemini-3.1-flash-tts-preview",
      modality: "tts",
      provider: "google",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://iu-test.example/gemini/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: { responseModalities: ["AUDIO"] },
    });
    expect(result.accessible).toBe(true);
    expect(result.probe_status).toBe("available");
  });
});

describe("probeModel — STT", () => {
  const audioFixture = new Blob([new Uint8Array(2048)], { type: "audio/mpeg" });

  it("marks available on 200 transcription response", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, { text: "hello" }));

    const result = await probeModel({
      model_id: "whisper",
      modality: "stt",
      provider: "openai",
      audioFixture,
    });

    expect(result.accessible).toBe(true);
    expect(result.modality).toBe("stt");
  });

  it("sends multipart/form-data with .mp3 filename", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, { text: "" }));

    await probeModel({
      model_id: "whisper",
      modality: "stt",
      provider: "openai",
      audioFixture,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.mp3");
    expect(file.type).toBe("audio/mpeg");
  });

  it("returns unknown (not accessible) when no audio fixture is available", async () => {
    const result = await probeModel({
      model_id: "whisper",
      modality: "stt",
      provider: "openai",
      audioFixture: null,
    });

    expect(result.accessible).toBe(false);
    expect(result.probe_status).toBe("unknown");
    expect(result.error).toContain("audio fixture");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
