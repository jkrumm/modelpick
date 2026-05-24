import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkAdminKey, generateTts, generateStt } from "../server/audio/generate.js";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xfb, 0x90, 0x64])),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function makeFetchResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  isAudio = false,
): Response {
  const contentType = isAudio ? "audio/mpeg" : "application/json";
  const responseHeaders = new Headers({ "content-type": contentType, ...headers });
  return {
    status,
    headers: responseHeaders,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(512),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_OPENAI_BASE_URL"] = "https://iu-test.example/openai/v1";
  process.env["IU_API_KEY"] = "test-key";
  process.env["ADMIN_KEY"] = "secret-admin";
});

afterEach(() => {
  delete process.env["ADMIN_KEY"];
});

// ── checkAdminKey ──────────────────────────────────────────────────────────────

describe("checkAdminKey", () => {
  it("accepts matching key", () => {
    expect(() => checkAdminKey("secret-admin")).not.toThrow();
  });

  it("rejects wrong key", () => {
    expect(() => checkAdminKey("wrong")).toThrow("Unauthorized");
  });

  it("rejects when ADMIN_KEY is not set", () => {
    delete process.env["ADMIN_KEY"];
    expect(() => checkAdminKey("any")).toThrow("Unauthorized");
  });

  it("rejects empty provided key", () => {
    expect(() => checkAdminKey("")).toThrow("Unauthorized");
  });
});

// ── generateTts ────────────────────────────────────────────────────────────────

describe("generateTts", () => {
  it("POSTs to /audio/speech with correct JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, new ArrayBuffer(512), { "x-ms-region": "Sweden Central" }, true),
    );

    const result = await generateTts("tts-hd", "Hello world");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("tts-hd");
    expect(body.input).toBe("Hello world");
    expect(result.audioBuffer).toBeInstanceOf(ArrayBuffer);
  });

  it("captures EU residency from Sweden Central header", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, new ArrayBuffer(512), { "x-ms-region": "Sweden Central" }, true),
    );

    const result = await generateTts("tts", "Test");
    expect(result.residency).toBe("eu");
  });

  it("captures US residency from OpenAI vendor header", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(
        200,
        new ArrayBuffer(512),
        { "x-middleware-forwarded-server": "OpenAI Vendor Group Key" },
        true,
      ),
    );

    const result = await generateTts("gpt-4o-mini-tts", "Test");
    expect(result.residency).toBe("us");
  });

  it("throws on non-2xx status", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(400, { error: { message: "invalid voice" } }),
    );

    await expect(generateTts("bad-model", "test")).rejects.toThrow(
      "TTS generation failed: HTTP 400",
    );
  });

  it("includes numeric latency_ms in result", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, new ArrayBuffer(512), {}, true),
    );

    const result = await generateTts("tts", "Test");
    expect(result.latency_ms).toBeTypeOf("number");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

// ── generateStt ────────────────────────────────────────────────────────────────

describe("generateStt", () => {
  it("POSTs to /audio/transcriptions as multipart with .mp3 filename", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { text: "hello world" }),
    );

    const result = await generateStt("whisper", "/tmp/test.mp3");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper");

    const file = form.get("file") as File;
    expect(file.name).toBe("audio.mp3");
    expect(result.text).toBe("hello world");
  });

  it("captures EU residency from response headers", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(200, { text: "text" }, { "x-ms-region": "Sweden Central" }),
    );

    const result = await generateStt("whisper", "/tmp/test.mp3");
    expect(result.residency).toBe("eu");
  });

  it("throws on non-2xx status", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(400, { error: { message: "invalid file" } }),
    );

    await expect(generateStt("whisper", "/tmp/test.mp3")).rejects.toThrow(
      "STT transcription failed: HTTP 400",
    );
  });

  it("includes numeric latency_ms in result", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse(200, { text: "test" }));

    const result = await generateStt("whisper", "/tmp/test.mp3");
    expect(result.latency_ms).toBeTypeOf("number");
  });
});

// ── groupBySource (demo grouping logic) ───────────────────────────────────────

type DemoLike = { id: number; audio_path: string | null; text_content: string };

function groupBySource(demos: DemoLike[]): Map<string, DemoLike[]> {
  const map = new Map<string, DemoLike[]>();
  for (const d of demos) {
    const key = d.audio_path ?? `text:${d.text_content.slice(0, 50)}`;
    const group = map.get(key) ?? [];
    group.push(d);
    map.set(key, group);
  }
  return map;
}

describe("groupBySource", () => {
  it("groups demos sharing the same audio_path", () => {
    const demos: DemoLike[] = [
      { id: 1, audio_path: "/demos/demo-1.mp3", text_content: "t1" },
      { id: 2, audio_path: "/demos/demo-1.mp3", text_content: "t1" },
      { id: 3, audio_path: "/demos/demo-2.mp3", text_content: "t2" },
    ];

    const groups = groupBySource(demos);
    expect(groups.get("/demos/demo-1.mp3")?.length).toBe(2);
    expect(groups.get("/demos/demo-2.mp3")?.length).toBe(1);
  });

  it("falls back to text prefix when audio_path is null", () => {
    const demos: DemoLike[] = [
      { id: 1, audio_path: null, text_content: "hello" },
    ];

    const groups = groupBySource(demos);
    expect(groups.has("text:hello")).toBe(true);
  });

  it("keeps separate groups for different audio sources", () => {
    const demos: DemoLike[] = [
      { id: 1, audio_path: "/demos/a.mp3", text_content: "t1" },
      { id: 2, audio_path: "/demos/b.mp3", text_content: "t2" },
    ];

    const groups = groupBySource(demos);
    expect(groups.size).toBe(2);
  });
});
