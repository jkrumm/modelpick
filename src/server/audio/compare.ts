import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CompareSample {
  id: string;
  preset: "chat" | "briefing" | "podcast";
  model: string;
  voice: string;
  gender: "m" | "f" | "mixed";
  file: string;
  /** How the audio was produced: single request, multi-speaker request, or turns concatenated. */
  mode: "single" | "multi" | "concat";
  latency_ms: number | null;
  first_audio_ms: number | null;
  duration_s: number | null;
  chars: number;
  cost_usd: number | null;
  cost_per_min: number | null;
  cost_source: string;
  /** gpt-transcribe round trip: true when the transcript matches the input verbatim (modulo punctuation/case). */
  verbatim: boolean | null;
  diff: string;
  streaming: string;
  aa_rank: string | null;
  /** "audition" = the Gemini 3.8 voice audition (real lane pipeline); absent = the cross-model comparison. */
  set?: "audition";
  /** The exact request(s) sent, audio omitted: model, style field, tags, voice config. */
  request?: string;
}

export interface CompareManifest {
  generated_at: string;
  texts: Record<string, string>;
  samples: CompareSample[];
}

export function getCompareDir(): string {
  return process.env["TTS_COMPARE_DIR"] ?? join(process.cwd(), "data", "tts-compare");
}

export async function readCompareManifest(): Promise<CompareManifest> {
  try {
    return JSON.parse(await readFile(join(getCompareDir(), "manifest.json"), "utf8"));
  } catch {
    return { generated_at: "", texts: {}, samples: [] };
  }
}
