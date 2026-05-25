import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dialectForProvider, iuFetch, parseResidency, rawFetch } from "../iu/client.js";
import { deriveProvider } from "../iu/discover.js";

export type AudioExt = "mp3" | "wav";

export interface TtsResult {
  audioBuffer: ArrayBuffer;
  /** Container the bytes are in — Gemini returns raw PCM we wrap as WAV. */
  ext: AudioExt;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

export interface TtsOptions {
  /** OpenAI voice (alloy, …) or Gemini prebuilt voice name (Kore, …). */
  voice?: string;
  /** Natural-language delivery directive prepended to the text (Gemini only). */
  style?: string;
}

/** Default Gemini voice — calm, informative adult-MALE narrator (medium pitch)
 *  that handles German well, matching the Hermes briefing persona (calm,
 *  conversational, no theatrics). Per Google Cloud TTS docs, Charon is a male
 *  voice; female voices (Sulafat, Kore, Zephyr, …) are intentionally avoided. */
export const GEMINI_DEFAULT_VOICE = "Charon";

/** OpenAI /audio/speech voices. `onyx` is the calm adult-male default, matching
 *  the Gemini side. A Gemini voice name passed via opts.voice is not valid here,
 *  so we fall back to the default unless the name is a known OpenAI voice. */
const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
const OPENAI_DEFAULT_VOICE = "onyx";

export interface SttResult {
  text: string;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

/** Throws "Unauthorized" if provided key does not match ADMIN_KEY env var. */
export function checkAdminKey(provided: string): void {
  const expected = process.env["ADMIN_KEY"] ?? "";
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized: invalid admin key");
  }
}

export function getDemosDir(): string {
  return process.env["DEMOS_DIR"] ?? join(process.cwd(), "public", "demos");
}

export async function ensureDemosDir(): Promise<void> {
  await mkdir(getDemosDir(), { recursive: true });
}

/** Wraps raw signed-16-bit little-endian PCM in a minimal WAV container so the
 *  browser <audio> element can play it. Gemini TTS returns headerless PCM. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): ArrayBuffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
  }>;
}

/** Gemini TTS only answers on the native generateContent route with an AUDIO
 *  response modality — the OpenAI /audio/speech route 404s. Expression is steered
 *  by a natural-language style directive prepended to the spoken text. */
async function generateGeminiTts(
  modelId: string,
  text: string,
  opts: TtsOptions,
): Promise<TtsResult> {
  const start = Date.now();
  const base = process.env["IU_GEMINI_BASE_URL"] ?? "";
  const voiceName = opts.voice ?? GEMINI_DEFAULT_VOICE;
  const prompt = opts.style ? `${opts.style}: ${text}` : text;

  const res = await rawFetch(`${base}/models/${modelId}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });

  if (typeof res.status !== "number" || res.status < 200 || res.status >= 300) {
    throw new Error(`TTS generation failed: HTTP ${res.status}`);
  }

  const inline = (JSON.parse(res.body) as GeminiTtsResponse).candidates?.[0]?.content?.parts?.[0]
    ?.inlineData;
  if (!inline?.data) {
    throw new Error("Gemini TTS returned no audio data");
  }
  const pcm = Uint8Array.from(Buffer.from(inline.data, "base64"));
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1]) || 24000;

  return {
    audioBuffer: pcmToWav(pcm, rate),
    ext: "wav",
    residency: res.headers ? parseResidency(res.headers) : "unknown",
    latency_ms: Date.now() - start,
  };
}

export async function generateTts(
  modelId: string,
  text: string,
  opts: TtsOptions = {},
): Promise<TtsResult> {
  if (dialectForProvider(deriveProvider(modelId)) === "gemini") {
    return generateGeminiTts(modelId, text, opts);
  }

  const start = Date.now();
  const voice = opts.voice && OPENAI_VOICES.has(opts.voice) ? opts.voice : OPENAI_DEFAULT_VOICE;
  const result = await iuFetch<ArrayBuffer>("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelId, input: text, voice, speed: 1.0 }),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`TTS generation failed: HTTP ${result.status}`);
  }
  return {
    audioBuffer: result.body,
    ext: "mp3",
    residency: parseResidency(result.headers),
    latency_ms: Date.now() - start,
  };
}

export async function writeDemoAudio(
  id: number,
  audioBuffer: ArrayBuffer,
  ext: AudioExt = "mp3",
): Promise<string> {
  await ensureDemosDir();
  const filename = `demo-${id}.${ext}`;
  await writeFile(join(getDemosDir(), filename), Buffer.from(audioBuffer));
  return `/demos/${filename}`;
}

/** Reads audio from disk and transcribes via IU STT. The .mp3 filename is required
 *  because the IU middleware sniffs the file extension, not the bytes. */
export async function generateStt(modelId: string, audioFilePath: string): Promise<SttResult> {
  const start = Date.now();
  const data = await readFile(audioFilePath);
  const blob = new Blob([data], { type: "audio/mpeg" });
  const form = new FormData();
  form.append("model", modelId);
  form.append("file", blob, "audio.mp3");
  const result = await iuFetch<{ text: string }>("/audio/transcriptions", {
    method: "POST",
    body: form,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`STT transcription failed: HTTP ${result.status}`);
  }
  const body = result.body as { text: string };
  return {
    text: body.text,
    residency: parseResidency(result.headers),
    latency_ms: Date.now() - start,
  };
}
