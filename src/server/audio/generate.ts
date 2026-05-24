import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { iuFetch, parseResidency } from "../iu/client.js";

export interface TtsResult {
  audioBuffer: ArrayBuffer;
  residency: "eu" | "us" | "unknown";
  latency_ms: number;
}

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

export async function generateTts(
  modelId: string,
  text: string,
  voice = "alloy",
): Promise<TtsResult> {
  const start = Date.now();
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
    residency: parseResidency(result.headers),
    latency_ms: Date.now() - start,
  };
}

export async function writeDemoAudio(
  id: number,
  audioBuffer: ArrayBuffer,
): Promise<string> {
  await ensureDemosDir();
  const filename = `demo-${id}.mp3`;
  await writeFile(join(getDemosDir(), filename), Buffer.from(audioBuffer));
  return `/demos/${filename}`;
}

/** Reads audio from disk and transcribes via IU STT. The .mp3 filename is required
 *  because the IU middleware sniffs the file extension, not the bytes. */
export async function generateStt(
  modelId: string,
  audioFilePath: string,
): Promise<SttResult> {
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
