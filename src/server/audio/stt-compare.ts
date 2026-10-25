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
  /** Windowed clips only: the unadjusted window WER/size, kept so `applyCoverage` stays idempotent. */
  window_wer_norm?: number | null;
  window_wer_raw?: number | null;
  window_ref_words?: number;
  /** Windowed clips only: share of the expected reference the hypothesis covered (a looping/truncating model scores < 1). */
  coverage?: number;
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

/** Reads a JSON file, returning `fallback` only when it does not exist yet; a corrupt file must fail loudly. */
async function readJson<T>(name: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(join(getSttDir(), name), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
  return JSON.parse(raw) as T;
}

export const readSttTestset = () => readJson<SttTestset>("testset.json", { generated_at: "", clips: [] });

export const readSttResults = () =>
  readJson<SttResults>("results.json", { generated_at: "", models: [], results: [], spend_usd: 0 });

/**
 * Windowed WER leaves the reference suffix after the last matched word free, so a transcript that stops early (or
 * loops) would be scored only on the part it covered. Charge the uncovered part against the largest window any model
 * covered on the same clip as deletions. Idempotent: always recomputed from the stored window_* fields.
 */
export function applyCoverage(results: SttResult[]): SttResult[] {
  const expected = new Map<string, number>();
  for (const r of results) {
    if (!r.ok || r.window_ref_words === undefined) continue;
    expected.set(r.clip, Math.max(expected.get(r.clip) ?? 0, r.window_ref_words));
  }
  return results.map((r) => {
    const exp = expected.get(r.clip);
    if (!r.ok || exp === undefined || r.window_ref_words === undefined) return r;
    const missing = exp - r.window_ref_words;
    const adj = (w: number | null | undefined) => (w === null || w === undefined ? null : (w * r.window_ref_words! + missing) / exp);
    return { ...r, wer_norm: adj(r.window_wer_norm), wer_raw: adj(r.window_wer_raw), ref_words: exp, coverage: r.window_ref_words / exp };
  });
}
