import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertLegsNonEmpty,
  diffCatalog,
  fetchLegListings,
  mergeLegs,
  modalityFromCapabilities,
  parseLeg,
  type LegListings,
} from "../server/iu/catalog.js";

const listings: LegListings = {
  openai: [
    {
      id: "claude-opus-5-5",
      owned_by: "Anthropic API OpenAI direct",
      Human_readable_name: "Claude Opus 5.5",
      ContextSize: "200000",
      Vendor: "Anthropic",
      Capabilities: ["ChatCompletion", "ImageInput"],
    },
    { id: "text-embedding-3-small", Capabilities: ["Embedding"], ContextSize: "8191" },
    { id: "tts-hd", Capabilities: ["VoiceOutput"] },
    { id: "whisper", Capabilities: ["VoiceInput"] },
    { id: "gpt-image-1", Capabilities: ["ImageGeneration", "ImageInput"] },
  ],
  anthropic: ["claude-opus-5-5"],
  gemini: ["gemini-3.8-flash", "claude-opus-5-5"],
  decisions: ["clef"],
};

describe("modalityFromCapabilities", () => {
  it.each([
    ["x", ["Embedding"], "embedding"],
    ["x", ["ImageGeneration", "ImageInput"], "image"],
    ["x", ["VoiceOutput"], "tts"],
    ["x", ["AudioInput"], "stt"],
    ["x", ["ChatCompletion", "AudioInput"], "llm"],
    ["x", ["ChatCompletion"], "llm"],
    ["x", ["ChatCompletion", "Embedding"], "llm"],
    ["x", ["Responses", "Functions", "ImageGeneration"], "llm"],
    ["x", ["ChatCompletion", "VoiceOutput"], "llm"],
    ["x", ["Responses", "VoiceInput"], "llm"],
    ["x", ["VoiceInput"], "stt"],
    ["gpt-6-sol", ["ChatCompletion", "Functions", "ImageGeneration", "ImageInput", "Responses"], "llm"],
    ["nano-banana", ["ChatCompletion", "ImageGeneration"], "image"],
    ["gpt-image-1.5", ["ChatCompletion", "ImageGeneration", "ImageInput", "ImageOutput", "Responses"], "image"],
    ["dall-e-3", ["ImageOutput"], "image"],
    ["clef", ["ChatCompletion"], "decision"],
    ["tts-hd", [], "tts"],
  ] as const)("%s %j → %s", (id, caps, expected) => {
    expect(modalityFromCapabilities(id, caps)).toBe(expected);
  });
});

describe("mergeLegs", () => {
  const rows = mergeLegs(listings);
  const byId = new Map(rows.map((r) => [r.id, r]));

  it("takes ids verbatim, one row per id, sorted", () => {
    expect(rows.map((r) => r.id)).toEqual(rows.map((r) => r.id).toSorted((a, b) => a.localeCompare(b)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("records metadata, owned_by and the legs that accept the id", () => {
    expect(byId.get("claude-opus-5-5")).toMatchObject({
      provider: "anthropic",
      display_name: "Claude Opus 5.5",
      context_window: 200000,
      owned_by: "Anthropic API OpenAI direct",
      legs: "openai,anthropic,gemini",
    });
  });

  it("keeps hidden-callable ids the API does not list", () => {
    expect(byId.get("claude-haiku-5-5-eu")).toMatchObject({ iu_listed: true, legs: "anthropic" });
  });

  it("adds ids only a non-OpenAI leg lists, with registered decision identity", () => {
    expect(byId.get("gemini-3.8-flash")).toMatchObject({ legs: "gemini", owned_by: null });
    expect(byId.get("clef")).toMatchObject({ modality: "decision", provider: "cloudflare", legs: "decisions" });
  });

  it("files a decisions-only id nobody registered as a decision model", () => {
    const rows = mergeLegs({ ...listings, decisions: ["clef", "jev-preview"] });
    expect(rows.find((r) => r.id === "jev-preview")).toMatchObject({
      modality: "decision",
      family: "decision",
      legs: "decisions",
    });
  });

  it("keeps a chat model that the decisions leg also lists as llm", () => {
    const rows = mergeLegs({
      openai: [{ id: "gpt-9", Capabilities: ["ChatCompletion"] }],
      anthropic: [],
      gemini: [],
      decisions: ["gpt-9"],
    });
    expect(rows.find((r) => r.id === "gpt-9")).toMatchObject({ modality: "llm", legs: "openai,decisions" });
  });

  it("files a chat model with auxiliary capabilities as llm", () => {
    const rows = mergeLegs({
      openai: [
        { id: "gpt-5.1", Capabilities: ["ChatCompletion", "Embedding"] },
        { id: "gpt-6-sol", Capabilities: ["Responses", "Functions", "ImageGeneration"] },
      ],
      anthropic: [],
      gemini: [],
      decisions: [],
    });
    expect(rows.filter((r) => r.id.startsWith("gpt-")).map((r) => r.modality)).toEqual(["llm", "llm"]);
  });

  it("uses the canonical provider, Vendor only for ids it cannot place", () => {
    const rows = mergeLegs({
      openai: [
        { id: "glm-5.3", Vendor: "Z.ai" },
        { id: "zz-unknown-1", Vendor: "Acme" },
      ],
      anthropic: [],
      gemini: [],
      decisions: [],
    });
    const byProvider = new Map(rows.map((r) => [r.id, r.provider]));
    expect(byProvider.get("glm-5.3")).toBe("zhipu");
    expect(byProvider.get("zz-unknown-1")).toBe("acme");
  });
});

describe("assertLegsNonEmpty", () => {
  it("throws naming the empty legs", () => {
    expect(() => assertLegsNonEmpty({ ...listings, gemini: [], decisions: [] })).toThrow(/gemini, decisions/);
  });
  it("passes a full listing", () => {
    expect(() => assertLegsNonEmpty(listings)).not.toThrow();
  });
});

describe("fetchLegListings", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = {
    IU_API_KEY: "k",
    IU_OPENAI_BASE_URL: "https://iu.example/openai",
    IU_ANTHROPIC_BASE_URL: "https://iu.example/anthropic",
    IU_GEMINI_BASE_URL: "https://iu.example/gemini",
    IU_DECISIONS_BASE_URL: "https://iu.example/decisions",
  } as NodeJS.ProcessEnv;

  it("names the missing base URL variable", async () => {
    await expect(fetchLegListings({ ...env, IU_GEMINI_BASE_URL: undefined })).rejects.toThrow(
      "IU_GEMINI_BASE_URL is not set",
    );
  });

  it("throws on a missing key before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLegListings({ ...env, IU_API_KEY: undefined })).rejects.toThrow("IU_API_KEY is not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a timeout signal with every request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLegListings(env)).rejects.toThrow("down");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("parseLeg", () => {
  it("strips the models/ prefix on Gemini names", () => {
    expect(parseLeg.gemini({ models: [{ name: "models/gemini-3-pro-preview" }] })).toEqual([
      "gemini-3-pro-preview",
    ]);
  });
  it("rejects a malformed listing instead of returning an empty catalog", () => {
    expect(() => parseLeg.openai({ nope: [] })).toThrow();
  });
});

describe("diffCatalog", () => {
  it("reports added and removed ids", () => {
    expect(diffCatalog(["a", "b"], [{ id: "b" }, { id: "c" }])).toEqual({ added: ["c"], removed: ["a"] });
  });
});
