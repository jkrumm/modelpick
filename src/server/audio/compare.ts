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
  set?: "audition" | "wave5" | "writer";
  /** The exact request(s) sent, audio omitted: model, style field, tags, voice config. */
  request?: string;
  /** Podcast-writer bake-off cells only: who wrote this script and what it cost. Hidden in the UI until revealed. */
  writer?: WriterCell;
}

/** One candidate's script for one segment, with the measurements shown on reveal. */
export interface WriterCell {
  /** Model id the voice owner ran as. */
  model: string;
  /** The final script, `Name: line` per turn. */
  script: string;
  words: number;
  targetWords: number;
  /** Improved-pipeline comparison only: the pipeline version this script came from. */
  stage?: "before" | "after";
  /** Wall time of draft + revision for this candidate (both segments), seconds. */
  wallSeconds?: number;
  /** Projected writer cost for a 20-minute episode, USD, at list price. */
  costUsdPerEpisode?: number;
  /** $/M output list price. */
  outputPricePerM?: number;
  /** Tag allowlist violations in the raw drafts. */
  tagViolations?: number;
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
