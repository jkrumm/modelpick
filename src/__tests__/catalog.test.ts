import { describe, it, expect } from "vitest";
import {
  diffCatalog,
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
