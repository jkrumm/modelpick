import { createServerFn } from "@tanstack/react-start";
import { join } from "node:path";
import {
  getModels,
  getPublicDemos,
  getAllDemos,
  insertDemo,
  updateDemoAudioPath,
  setDemoPublic,
  setDemoPublicByVoice,
} from "~/db/queries";
import {
  checkAdminKey,
  generateTts,
  generateStt,
  writeDemoAudio,
  getDemosDir,
} from "~/server/audio/generate";
import type { Demo, Model } from "~/db/schema";
import {
  TTS_PRESETS,
  TTS_CANDIDATE_VOICES,
  type TtsPreset,
  type CandidateVoice,
} from "~/server/audio/presets";

export { TTS_PRESETS, TTS_CANDIDATE_VOICES };
export type { TtsPreset, CandidateVoice };

// EU-resident model IDs per the IU capability matrix (tts/tts-hd/whisper = Azure
// Sweden). Gemini TTS routes through IU's "GDPR ONLY" Gemini gateway, so it is
// EU-resident even though the response carries no Azure region header.
export const EU_TTS_MODELS = new Set([
  "tts",
  "tts-hd",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
]);
export const EU_STT_MODELS = new Set(["whisper"]);

// ── Shared interfaces ──────────────────────────────────────────────────────────

export interface AudioPlaygroundData {
  models: Model[];
  demos: Demo[];
}

export interface SttPlaygroundData {
  models: Model[];
  demos: Demo[];
  /** TTS demos that have audio, available as STT source audio. */
  ttsAudioDemos: Demo[];
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
  adminKey: string;
}

export interface RunSttDemoInput {
  modelId: string;
  /** ID of a TTS demo whose audio file will be transcribed. */
  sourceDemoId: number;
  adminKey: string;
}

export interface ToggleDemoPublicInput {
  id: number;
  isPublic: boolean;
  adminKey: string;
}

export interface GenerateTtsResult {
  id: number;
  audioPath: string;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

export interface RunSttResult {
  id: number;
  text: string;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getTtsPlaygroundData = createServerFn({ method: "GET" }).handler(
  async (): Promise<AudioPlaygroundData> => {
    const [ttsModels, ttsDemos] = await Promise.all([getModels("tts"), getPublicDemos("tts")]);
    return { models: ttsModels, demos: ttsDemos };
  },
);

export const getSttPlaygroundData = createServerFn({ method: "GET" }).handler(
  async (): Promise<SttPlaygroundData> => {
    const [sttModels, sttDemos, ttsDemos] = await Promise.all([
      getModels("stt"),
      getPublicDemos("stt"),
      getPublicDemos("tts"),
    ]);
    return {
      models: sttModels,
      demos: sttDemos,
      ttsAudioDemos: ttsDemos.filter((d) => d.audio_path !== null),
    };
  },
);

export const getAdminDemosFn = createServerFn({ method: "GET" })
  .inputValidator((input: { modality: "tts" | "stt"; adminKey: string }) => input)
  .handler(async ({ data }): Promise<Demo[]> => {
    checkAdminKey(data.adminKey);
    return getAllDemos(data.modality);
  });

export const generateTtsDemoFn = createServerFn({ method: "POST" })
  .inputValidator((input: GenerateTtsDemoInput) => input)
  .handler(async ({ data }): Promise<GenerateTtsResult> => {
    checkAdminKey(data.adminKey);

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

export const runSttDemoFn = createServerFn({ method: "POST" })
  .inputValidator((input: RunSttDemoInput) => input)
  .handler(async ({ data }): Promise<RunSttResult> => {
    checkAdminKey(data.adminKey);

    const allTtsDemos = await getAllDemos("tts");
    const sourceDemoRow = allTtsDemos.find((d) => d.id === data.sourceDemoId);
    if (!sourceDemoRow?.audio_path) {
      throw new Error(`Source demo ${data.sourceDemoId} has no audio file`);
    }

    // Convert the URL path (/demos/demo-N.mp3) to an absolute FS path.
    const audioFilePath = join(getDemosDir(), sourceDemoRow.audio_path.replace(/^\/demos\//, ""));

    const { text, residency, latency_ms } = await generateStt(data.modelId, audioFilePath);

    const sttDemo = await insertDemo({
      modality: "stt",
      model_id: data.modelId,
      text_content: text,
      lang: sourceDemoRow.lang,
      preset: sourceDemoRow.preset,
      audio_path: sourceDemoRow.audio_path,
      public: false,
    });

    return { id: sttDemo.id, text, residency, latency_ms };
  });

export const toggleDemoPublicFn = createServerFn({ method: "POST" })
  .inputValidator((input: ToggleDemoPublicInput) => input)
  .handler(async ({ data }): Promise<void> => {
    checkAdminKey(data.adminKey);
    await setDemoPublic(data.id, data.isPublic);
  });

export interface ToggleVoiceInput {
  modality: "tts" | "stt";
  voice: string;
  isPublic: boolean;
  adminKey: string;
}

/** Enable/disable an entire voice at once — bulk public toggle for narrowing the
 *  TTS candidate shortlist. */
export const toggleVoicePublicFn = createServerFn({ method: "POST" })
  .inputValidator((input: ToggleVoiceInput) => input)
  .handler(async ({ data }): Promise<void> => {
    checkAdminKey(data.adminKey);
    await setDemoPublicByVoice(data.modality, data.voice, data.isPublic);
  });
