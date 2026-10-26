import { describe, it, expect } from "vitest";
import { pickBestAudio } from "../server/scoring/recommend.js";
import type { Modality } from "../db/schema.js";

const probe = (latency_ms: number) => ({ accessible: true, latency_ms });

describe("pickBestAudio", () => {
  const modality = new Map<string, Modality>([
    ["gemini-3.8-flash-tts", "tts"],
    ["tts-hd", "tts"],
    ["whisper", "stt"],
    ["voxtral-mini", "stt"],
  ]);
  const probes = new Map([
    ["gemini-3.8-flash-tts", probe(500)],
    ["tts-hd", probe(300)],
    ["whisper", probe(400)],
    ["voxtral-mini", probe(200)],
  ]);

  it("ranks on measured TTS Elo, overriding the generation preference", () => {
    const top = pickBestAudio("tts", modality, probes, new Map([["gemini-3.8-flash-tts", 1283], ["tts-hd", 1400]]));
    expect(top).toMatchObject({ model_id: "tts-hd", score: 1, measured: true });
  });

  it("ignores unmeasured candidates once any accessible one is measured", () => {
    const top = pickBestAudio("tts", modality, probes, new Map([["tts-hd", 1100]]));
    expect(top?.model_id).toBe("tts-hd");
  });

  it("ranks STT on lowest word error rate (negated upstream)", () => {
    const top = pickBestAudio("stt", modality, probes, new Map([["whisper", -0.08], ["voxtral-mini", -0.05]]));
    expect(top?.model_id).toBe("voxtral-mini");
  });

  it("falls back to the generation rank with no measurements", () => {
    const top = pickBestAudio("tts", modality, probes, new Map());
    expect(top).toMatchObject({ model_id: "gemini-3.8-flash-tts", measured: false });
  });
});
