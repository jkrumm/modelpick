import { createServerFn } from "@tanstack/react-start";
import {
  getModels,
  getAllDemos,
  insertDemo,
  updateDemoAudioPath,
  setDemoPublic,
  setDemoPublicByVoice,
} from "~/db/queries";
import { generateTts, writeDemoAudio } from "~/server/audio/generate";
import type { Demo, Model } from "~/db/schema";
import { readCompareManifest } from "~/server/audio/compare";
import {
  TTS_PRESETS,
  TTS_CANDIDATE_VOICES,
  type TtsPreset,
  type CandidateVoice,
} from "~/server/audio/presets";

export { TTS_PRESETS, TTS_CANDIDATE_VOICES };
export type { TtsPreset, CandidateVoice };

// EU-resident model IDs per the IU capability matrix (tts/tts-hd = Azure
// Sweden). Gemini TTS routes through IU's "GDPR ONLY" Gemini gateway, so it is
// EU-resident even though the response carries no Azure region header.
export const EU_TTS_MODELS = new Set([
  "tts",
  "tts-hd",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
]);

// ── Shared interfaces ──────────────────────────────────────────────────────────

export interface AudioPlaygroundData {
  models: Model[];
  demos: Demo[];
}

export interface GenerateTtsDemoInput {
  modelId: string;
  text: string;
  lang: "de" | "en";
  preset: string;
  /** Delivery directive (Gemini only); OpenAI-route models ignore it. */
  style?: string;
  /** Gemini prebuilt voice name; OpenAI-route models ignore it. */
  voice?: string;
}

export interface ToggleDemoPublicInput {
  id: number;
  isPublic: boolean;
}

export interface GenerateTtsResult {
  id: number;
  audioPath: string;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getTtsPlaygroundData = createServerFn({ method: "GET" }).handler(
  async (): Promise<AudioPlaygroundData> => {
    const [ttsModels, ttsDemos] = await Promise.all([getModels("tts"), getAllDemos("tts")]);
    return { models: ttsModels, demos: ttsDemos };
  },
);

export const getAllDemosFn = createServerFn({ method: "GET" })
  .inputValidator((input: { modality: "tts" | "stt" }) => input)
  .handler(async ({ data }): Promise<Demo[]> => {
    return getAllDemos(data.modality);
  });

export const generateTtsDemoFn = createServerFn({ method: "POST" })
  .inputValidator((input: GenerateTtsDemoInput) => input)
  .handler(async ({ data }): Promise<GenerateTtsResult> => {
    // Insert placeholder row to get the auto-increment ID before generating audio.
    const demoRow = await insertDemo({
      modality: "tts",
      model_id: data.modelId,
      text_content: data.text,
      lang: data.lang,
      preset: data.preset,
      voice: data.voice ?? null,
      public: false,
    });

    const { audioBuffer, ext, residency, latency_ms } = await generateTts(data.modelId, data.text, {
      ...(data.style ? { style: data.style } : {}),
      ...(data.voice ? { voice: data.voice } : {}),
    });

    const audioPath = await writeDemoAudio(demoRow.id, audioBuffer, ext);
    await updateDemoAudioPath(demoRow.id, audioPath);

    return { id: demoRow.id, audioPath, residency, latency_ms };
  });

export const toggleDemoPublicFn = createServerFn({ method: "POST" })
  .inputValidator((input: ToggleDemoPublicInput) => input)
  .handler(async ({ data }): Promise<void> => {
    await setDemoPublic(data.id, data.isPublic);
  });

export interface ToggleVoiceInput {
  modality: "tts" | "stt";
  voice: string;
  isPublic: boolean;
}

/** Enable/disable an entire voice at once — bulk public toggle for narrowing the
 *  TTS candidate shortlist. */
export const toggleVoicePublicFn = createServerFn({ method: "POST" })
  .inputValidator((input: ToggleVoiceInput) => input)
  .handler(async ({ data }): Promise<void> => {
    await setDemoPublicByVoice(data.modality, data.voice, data.isPublic);
  });

// ── German TTS comparison (data/tts-compare/manifest.json) ─────────────────────

export const getTtsCompareFn = createServerFn({ method: "GET" }).handler(async () =>
  readCompareManifest(),
);
