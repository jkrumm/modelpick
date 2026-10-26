import type { CollectorResult, IdResolver, NormalizedMetric } from "./normalize.js";

// ArtificialAnalysis speech leaderboards (same x-api-key as the LLM list):
//   TTS  /media/text-to-speech/models/free   → elo, ci_95        (higher = better)
//   STT  /media/speech-to-text/models/free   → aa_wer_index      (word error rate, lower = better)
// Stored raw as `tts_elo` / `stt_wer_index`; the audio recommender reads them.
interface AATtsModel {
  name: string;
  slug?: string | null;
  elo?: number | null;
  ci_95?: number | null;
}

interface AASttModel {
  name: string;
  slug?: string | null;
  aa_wer_index?: number | null;
}

interface AAPage<T> {
  data?: T[];
  pagination?: { has_more?: boolean } | null;
}

const AA_MEDIA_URL = "https://artificialanalysis.ai/api/v2/media";
const MAX_PAGES = 20;

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(`${AA_MEDIA_URL}/${path}/models/free?page=${page}`, {
      headers: { "x-api-key": key },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${path} page ${page}`);
    const body = (await resp.json()) as AAPage<T>;
    rows.push(...(body.data ?? []));
    if (!body.pagination?.has_more) break;
  }
  return rows;
}

/** STT rows have no slug and read "GPT-4o Mini Transcribe, OpenAI" — drop the vendor suffix. */
function stripVendorSuffix(name: string): string {
  const i = name.lastIndexOf(", ");
  return i === -1 ? name : name.slice(0, i);
}

/** "GPT-4o Mini Transcribe" → "gpt-4o-mini-transcribe": the form catalog ids take. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Wider elo error bars earn less trust; ci_95 of 0 or missing keeps the 0.9 default. */
function eloConfidence(ci: number | null | undefined): number {
  if (ci === null || ci === undefined || !isFinite(ci) || ci <= 0) return 0.9;
  return Math.max(0.5, Math.min(0.9, 0.9 - ci / 200));
}

export async function collectArtificialAnalysisSpeech(
  resolve: IdResolver,
): Promise<CollectorResult> {
  const key = process.env["ARTIFICIALANALYSIS_API_KEY"] ?? "";
  if (!key) {
    console.warn("[aa-speech] ARTIFICIALANALYSIS_API_KEY not set — skipping");
    return { metrics: [], unmatched: [] };
  }

  const metrics: NormalizedMetric[] = [];
  const unmatched: { externalId: string; name: string }[] = [];

  try {
    for (const m of await fetchAll<AATtsModel>("text-to-speech", key)) {
      if (m.elo === null || m.elo === undefined || !isFinite(m.elo)) continue;
      const id = m.slug ?? m.name;
      const localId = resolve(id) ?? resolve(slugify(m.name));
      if (!localId) {
        unmatched.push({ externalId: `tts:${id}`, name: m.name });
        continue;
      }
      metrics.push({
        model_id: localId,
        source: "artificialanalysis",
        metric: "tts_elo",
        value: m.elo,
        confidence: eloConfidence(m.ci_95),
      });
    }
  } catch (err) {
    console.warn(`[aa-speech] tts: ${String(err)} — skipping`);
  }

  try {
    for (const m of await fetchAll<AASttModel>("speech-to-text", key)) {
      // null = AA has no WER sample; a missing sample must not become 0 (perfect).
      if (m.aa_wer_index === null || m.aa_wer_index === undefined || !isFinite(m.aa_wer_index)) {
        continue;
      }
      const id = m.slug ?? stripVendorSuffix(m.name);
      const localId = resolve(id) ?? resolve(slugify(id));
      if (!localId) {
        unmatched.push({ externalId: `stt:${id}`, name: m.name });
        continue;
      }
      metrics.push({
        model_id: localId,
        source: "artificialanalysis",
        metric: "stt_wer_index",
        value: m.aa_wer_index,
        confidence: 0.9,
      });
    }
  } catch (err) {
    console.warn(`[aa-speech] stt: ${String(err)} — skipping`);
  }

  return { metrics, unmatched };
}
