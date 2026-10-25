import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SttClip {
  id: string;
  kind: "short" | "noisy" | "long" | "duo";
  file: string;
  reference: string;
  source: string;
  licence: string;
  speakers: number;
  /** Reference is a larger free window than the audio covers; score with a free-end alignment. */
  windowed?: boolean;
  turns?: { speaker: string; text: string }[];
}

export interface SttTestset {
  generated_at: string;
  clips: SttClip[];
}

export interface SttResult {
  clip: string;
  model: string;
  /** Where it ran: an IU cloud route or a local MacWhisper engine. */
  where: "iu" | "local";
  ok: boolean;
  error?: string;
  hypothesis: string;
  latency_ms: number | null;
  audio_s: number;
  /** Real-time factor: latency / audio duration (lower is faster). */
  rtf: number | null;
  wer_norm: number | null;
  wer_raw: number | null;
  /** Number of distinct speakers the model reported (diarizing models only). */
  speakers_detected?: number | null;
  /** Share of reference words the hypothesis assigns to the right speaker (duo clip only). */
  speaker_acc?: number | null;
  /** Reference words in the scored window. */
  ref_words: number;
  hyp_words: number;
  request?: string;
}

export interface SttModelInfo {
  model: string;
  where: "iu" | "local";
  residency: string;
  per_min: number | null;
  cost_source: string;
  diarization: string;
  word_timestamps: string;
  howto: string;
  note?: string;
}

export interface SttResults {
  generated_at: string;
  models: SttModelInfo[];
  results: SttResult[];
  spend_usd: number;
}

export function getSttDir(): string {
  return process.env["STT_COMPARE_DIR"] ?? join(process.cwd(), "data", "stt-compare");
}

export async function readSttTestset(): Promise<SttTestset> {
  try {
    return JSON.parse(await readFile(join(getSttDir(), "testset.json"), "utf8"));
  } catch {
    return { generated_at: "", clips: [] };
  }
}

export async function readSttResults(): Promise<SttResults> {
  try {
    return JSON.parse(await readFile(join(getSttDir(), "results.json"), "utf8"));
  } catch {
    return { generated_at: "", models: [], results: [], spend_usd: 0 };
  }
}
