import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyReplicateModality,
  fetchReplicateCatalog,
  probeReplicate,
  type ReplicateModel,
} from "../server/iu/replicate.js";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  process.env["IU_REPLICATE_BASE_URL"] = "https://iu-test.example/replicate/v1";
  process.env["IU_API_KEY"] = "test-key";
});

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

function makeModel(overrides: Partial<ReplicateModel> = {}): ReplicateModel {
  return {
    id: "minimax/speech-02-turbo",
    description: "State of the art text-to-speech model.",
    run_count: 1000,
    inputProps: ["text"],
    inputRequired: ["text"],
    ...overrides,
  };
}

// ── classifyReplicateModality ───────────────────────────────────────────────

describe("classifyReplicateModality", () => {
  it("classifies a text-to-speech model with a text input as tts", () => {
    const m = makeModel({
      id: "minimax/speech-02-turbo",
      description: "State of the art text-to-speech model.",
      inputProps: ["text"],
    });
    expect(classifyReplicateModality(m)).toBe("tts");
  });

  it("classifies an ElevenLabs-style prompt-input model as tts", () => {
    const m = makeModel({
      id: "elevenlabs/v3",
      description: "ElevenLabs' most expressive text-to-speech model.",
      inputProps: ["prompt", "voice"],
    });
    expect(classifyReplicateModality(m)).toBe("tts");
  });

  it("classifies a transcription model with an audio input as stt", () => {
    const m = makeModel({
      id: "openai/gpt-4o-transcribe",
      description: "Transcribe audio to text.",
      inputProps: ["audio_file"],
    });
    expect(classifyReplicateModality(m)).toBe("stt");
  });

  it("classifies a diarization model matched by id wording as stt", () => {
    const m = makeModel({
      id: "thomasmol/whisper-diarization",
      description: "Speaker diarization pipeline.",
      inputProps: ["audio"],
    });
    expect(classifyReplicateModality(m)).toBe("stt");
  });

  it("skips a model with no relevant input or wording", () => {
    const m = makeModel({
      id: "meta/llama-4",
      description: "A large language model.",
      inputProps: ["prompt"],
    });
    expect(classifyReplicateModality(m)).toBeNull();
  });

  it("excludes image/document OCR models even with transcribe wording and a file input", () => {
    const m = makeModel({
      id: "datalab-to/ocr",
      description:
        "Detect and transcribe text in images with accurate bounding boxes, layout preservation.",
      inputProps: ["file"],
      inputRequired: ["file"],
    });
    expect(classifyReplicateModality(m)).toBeNull();
  });

  it("does not treat a bare 'file' input as audio for stt classification", () => {
    const m = makeModel({
      id: "some-owner/transcribe-thing",
      description: "Transcribes speech from an uploaded recording.",
      inputProps: ["file"],
    });
    expect(classifyReplicateModality(m)).toBeNull();
  });

  it("resolves ambiguous dual-purpose models (empty required, matches both wordings) to stt", () => {
    const m = makeModel({
      id: "ibm-granite/granite-speech-3.3-8b",
      description: "Speech-to-text recognition and text-to-speech synthesis in one model.",
      inputProps: ["text", "audio"],
      inputRequired: [],
    });
    expect(classifyReplicateModality(m)).toBe("stt");
  });
});

// ── fetchReplicateCatalog (pagination + cursor rewrite) ─────────────────────

describe("fetchReplicateCatalog", () => {
  it("filters to is_official models only", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        next: null,
        previous: null,
        results: [
          {
            owner: "minimax",
            name: "speech-02-turbo",
            description: "tts",
            run_count: 5,
            is_official: true,
            latest_version: {
              openapi_schema: {
                components: {
                  schemas: { Input: { properties: { text: {} }, required: ["text"] } },
                },
              },
            },
          },
          {
            owner: "jaaari",
            name: "kokoro-82m",
            description: "unofficial tts",
            run_count: 1,
            is_official: false,
          },
        ],
      }),
    );

    const catalog = await fetchReplicateCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.id).toBe("minimax/speech-02-turbo");
    expect(catalog[0]?.inputProps).toEqual(["text"]);
    expect(catalog[0]?.inputRequired).toEqual(["text"]);
  });

  it("rewrites the internal-host next URL to a cursor param on the configured base", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          next: "https://ue-ng-main.azurewebsites.net/replicate/v1/models?cursor=abc123",
          previous: null,
          results: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { next: null, previous: null, results: [] }));

    await fetchReplicateCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0] as [string];
    const [secondUrl] = fetchMock.mock.calls[1] as [string];
    expect(firstUrl).toBe("https://iu-test.example/replicate/v1/models");
    expect(secondUrl).toBe("https://iu-test.example/replicate/v1/models?cursor=abc123");
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    await expect(fetchReplicateCatalog()).rejects.toThrow(/HTTP 500/);
  });
});

// ── probeReplicate (input-key retry + failed-prediction mapping) ───────────

describe("probeReplicate", () => {
  it("sends {text} first for tts and returns the success as-is", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { status: "succeeded", output: "..." }));

    const result = await probeReplicate({ model_id: "minimax/speech-02-turbo", modality: "tts" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://iu-test.example/replicate/v1/models/minimax/speech-02-turbo/predictions",
    );
    expect(JSON.parse(init.body as string)).toEqual({ input: { text: "hi" } });
    expect(result.status).toBe(201);
  });

  it("retries with {prompt} on a 422 for tts (elevenlabs-style models)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, { error: "text is not a valid input" }))
      .mockResolvedValueOnce(jsonResponse(201, { status: "succeeded", output: "..." }));

    const result = await probeReplicate({ model_id: "elevenlabs/v3", modality: "tts" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(secondInit.body as string)).toEqual({ input: { prompt: "hi" } });
    expect(result.status).toBe(201);
  });

  it("retries with {audio_file} on a 422 for stt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, { error: "audio is not a valid input" }))
      .mockResolvedValueOnce(jsonResponse(201, { status: "succeeded", output: "hello" }));

    const result = await probeReplicate({
      model_id: "openai/gpt-4o-transcribe",
      modality: "stt",
      audioDataUri: "data:audio/mpeg;base64,AAAA",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(secondInit.body as string)).toEqual({
      input: { audio_file: "data:audio/mpeg;base64,AAAA" },
    });
    expect(result.status).toBe(201);
  });

  it("returns an unknown-fixture result for stt without an audio data URI", async () => {
    const result = await probeReplicate({ model_id: "openai/gpt-4o-transcribe", modality: "stt" });

    expect(result.status).toBe(0);
    expect(result.body).toContain("audio fixture");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 2xx response with a failed prediction status to 502", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { status: "failed", error: "CUDA out of memory" }),
    );

    const result = await probeReplicate({ model_id: "minimax/speech-02-turbo", modality: "tts" });

    expect(result.status).toBe(502);
    expect(result.body).toContain("CUDA out of memory");
  });
});

// ── Real vendor descriptions ────────────────────────────────────────────────
// Verbatim from the live IU Replicate catalog. Vendors phrase the same concept
// with hyphens, spaces or not at all, so the classifier is pinned against the
// real strings rather than idealised ones — an earlier hyphen-only regex
// matched just 9 of these 20.

const REAL_TTS: ReadonlyArray<readonly [string, string, string[]]> = [
  ["elevenlabs/v3", "The most expressive Text to Speech model", ["prompt"]],
  ["elevenlabs/flash-v2.5", "ElevenLabs's fastest speech synthesis model", ["prompt"]],
  ["elevenlabs/turbo-v2.5", "High quality, low latency text to speech in 32 languages", ["prompt"]],
  [
    "elevenlabs/v2-multilingual",
    "Generate multilingual text-to-speech audio in over 30 languages",
    ["prompt"],
  ],
  [
    "minimax/speech-2.8-turbo",
    "Minimax Speech 2.8 Turbo: Turn text into natural, expressive speech with voice cloning, emotion control, and support for 40+ languages",
    ["text"],
  ],
  [
    "minimax/speech-2.8-hd",
    "Minimax Speech 2.8 HD focuses on high-fidelity audio generation with features like studio-grade quality, flexible emotion control, multilingual support, and voice cloning capabilities",
    ["text"],
  ],
  [
    "minimax/speech-2.6-hd",
    "MiniMax Speech 2.6 HD delivers studio-quality multilingual text-to-audio on Replicate with nuanced prosody, subtitle export, and premium voices",
    ["text"],
  ],
  [
    "minimax/speech-02-turbo",
    "Text-to-Audio (T2A) that offers voice synthesis, emotional expression, and multilingual capabilities",
    ["text"],
  ],
  [
    "resemble-ai/chatterbox-pro",
    "Generate expressive, natural speech with Resemble AI's Chatterbox.",
    ["prompt"],
  ],
  [
    "playht/play-dialog",
    "End-to-end AI speech model designed for natural-sounding conversational speech synthesis, with support for multiple speakers",
    ["text"],
  ],
  [
    "xai/grok-text-to-speech",
    "Convert text to natural-sounding speech with xAI's Grok TTS. 5 voices, multiple languages",
    ["text"],
  ],
];

const REAL_STT: ReadonlyArray<readonly [string, string, string[]]> = [
  [
    "elevenlabs/scribe-v2",
    "Transcribe speech with ElevenLabs Scribe v2. 90+ languages, word-level timestamps, speaker diarization",
    ["audio"],
  ],
  [
    "openai/gpt-4o-transcribe",
    "A speech-to-text model that uses GPT-4o to transcribe audio",
    ["audio_file"],
  ],
  [
    "xai/grok-speech-to-text",
    "Transcribe audio to text with xAI's Grok. Handles 25 languages, word-level timestamps, speaker diarization",
    ["audio"],
  ],
];

describe("classifyReplicateModality — real catalog descriptions", () => {
  it.each(REAL_TTS)("classifies %s as tts", (id, description, inputProps) => {
    expect(classifyReplicateModality(makeModel({ id, description, inputProps }))).toBe("tts");
  });

  it.each(REAL_STT)("classifies %s as stt", (id, description, inputProps) => {
    expect(classifyReplicateModality(makeModel({ id, description, inputProps }))).toBe("stt");
  });

  it("keeps a tts model whose description mentions subtitles but takes no audio in", () => {
    // minimax/speech-2.6-hd advertises "subtitle export" — an STT-flavoured word
    // on a pure text-in model. It must not be vetoed out of the tts lane.
    const m = makeModel({
      id: "minimax/speech-2.6-hd",
      description: "multilingual text-to-audio with nuanced prosody, subtitle export",
      inputProps: ["text"],
    });
    expect(classifyReplicateModality(m)).toBe("tts");
  });
});
