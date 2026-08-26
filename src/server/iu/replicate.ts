import type { Modality } from "../../db/schema.js";

// The IU gateway's Replicate route (`/replicate/v1`) proxies Replicate's own
// native catalog + prediction API, distinct from the per-provider IU-native
// routes in client.ts. This module owns everything Replicate-specific: catalog
// paging, official-model filtering, modality classification from the model's
// input schema + description, and the synchronous prediction probe.

export const replicateBase = (): string => process.env["IU_REPLICATE_BASE_URL"] ?? "";

const PROBE_TIMEOUT_MS = 30_000;

export interface ReplicateModel {
  id: string; // `${owner}/${name}`
  description: string;
  run_count: number;
  inputProps: string[];
  inputRequired: string[];
}

// Raw shape from Replicate's native paginated /models endpoint.
interface ReplicateInputSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ReplicateRawResult {
  owner: string;
  name: string;
  description?: string;
  run_count?: number;
  is_official?: boolean;
  latest_version?: {
    openapi_schema?: {
      components?: {
        schemas?: {
          Input?: ReplicateInputSchema;
        };
      };
    };
  };
}

interface ReplicatePage {
  next: string | null;
  previous: string | null;
  results: ReplicateRawResult[];
}

function toReplicateModel(raw: ReplicateRawResult): ReplicateModel {
  const inputSchema = raw.latest_version?.openapi_schema?.components?.schemas?.Input;
  return {
    id: `${raw.owner}/${raw.name}`,
    description: raw.description ?? "",
    run_count: raw.run_count ?? 0,
    inputProps: inputSchema?.properties ? Object.keys(inputSchema.properties) : [],
    inputRequired: inputSchema?.required ?? [],
  };
}

// `next` points at Replicate's internal host (ue-ng-main.azurewebsites.net),
// which the gateway doesn't proxy — only its `cursor` param is usable, re-issued
// against our own configured base.
function nextCursorParam(nextUrl: string | null): string | null {
  if (!nextUrl) return null;
  try {
    return new URL(nextUrl).searchParams.get("cursor");
  } catch {
    return null;
  }
}

/** Walks the full Replicate catalog, returning only routed (`is_official`) models. */
export async function fetchReplicateCatalog(): Promise<ReplicateModel[]> {
  const key = process.env["IU_API_KEY"] ?? "";
  const results: ReplicateModel[] = [];
  let url: string | null = `${replicateBase()}/models`;

  while (url) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Replicate /models returned HTTP ${resp.status}`);
    }
    const page = (await resp.json()) as ReplicatePage;
    for (const raw of page.results) {
      if (raw.is_official === true) {
        results.push(toReplicateModel(raw));
      }
    }
    const cursor = nextCursorParam(page.next);
    url = cursor ? `${replicateBase()}/models?cursor=${cursor}` : null;
  }

  return results;
}

// Vendor descriptions separate these terms inconsistently ("text-to-speech",
// "text to speech", "Text to Speech"), so every multi-word term is matched
// separator-agnostically — a hyphen-only regex silently drops half the catalog.
const SEP = String.raw`[\s-]+`;
const TTS_WORDING = new RegExp(
  [
    `text${SEP}to${SEP}(speech|audio)`,
    String.raw`\btts\b`,
    `voice${SEP}clon`,
    `(speech|voice)${SEP}synthesis`,
    String.raw`generate[\s\S]{0,40}\bspeech\b`,
  ].join("|"),
);
const STT_WORDING = /transcri|speech[\s-]+to[\s-]+text|\basr\b|diariz|subtitle/;
// Guards against non-speech models whose description happens to say
// "transcribe" (e.g. datalab-to/ocr: "Detect and transcribe text in images
// with accurate bounding boxes, layout...") — those are document/image OCR,
// not audio transcription.
const IMAGE_DOC_WORDING = /\bimage\b|document|\bocr\b|bounding box|layout/;
// A bare "file" input is too generic (OCR models take it too) — require a
// genuinely audio-named input for STT.
const AUDIO_INPUT_KEYS = ["audio", "audio_file", "audio_input"];

/** Classifies a Replicate model into the speech lane we import (tts/stt), or
 *  null to skip it — image/LLM Replicate models duplicate the IU-native catalog. */
export function classifyReplicateModality(m: ReplicateModel): Modality | null {
  const desc = m.description.toLowerCase();
  const id = m.id.toLowerCase();
  if (IMAGE_DOC_WORDING.test(desc)) return null;

  const hasTextInput = m.inputProps.includes("text") || m.inputProps.includes("prompt");
  const hasAudioInput = AUDIO_INPUT_KEYS.some((key) => m.inputProps.includes(key));

  const matchesStt = hasAudioInput && (STT_WORDING.test(desc) || STT_WORDING.test(id));
  // STT wording only vetoes a TTS match when the model actually takes audio in.
  // Otherwise a TTS model that merely advertises a side feature ("subtitle
  // export" on minimax/speech-2.6-hd) gets silently dropped.
  const matchesTts = hasTextInput && TTS_WORDING.test(desc) && !(hasAudioInput && matchesStt);

  // A handful of models (e.g. ibm-granite/granite-speech-*) ship both text and
  // audio inputs with an empty `required` list and wording that matches both
  // patterns. Resolve deterministically: STT wins on ambiguity.
  if (matchesStt) return "stt";
  if (matchesTts) return "tts";
  return null;
}

async function postPrediction(
  model_id: string,
  input: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const key = process.env["IU_API_KEY"] ?? "";
  const url = `${replicateBase()}/models/${model_id}/predictions`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        Prefer: "wait",
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: 0, body: "probe timed out" };
    }
    return { status: 0, body: err instanceof Error ? err.message : String(err) };
  }

  const body = await resp.text();
  if (resp.status >= 200 && resp.status < 300) {
    try {
      const parsed = JSON.parse(body) as { status?: string; error?: unknown };
      if (parsed.status === "failed") {
        const errorBody =
          typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error ?? parsed);
        // A "failed" prediction reached the model but didn't succeed — surface it
        // as a non-2xx-ish outcome so classifyProbe doesn't call it available.
        return { status: 502, body: errorBody };
      }
    } catch {
      // non-JSON success body — pass through as-is
    }
  }
  return { status: resp.status, body };
}

export interface ProbeReplicateOptions {
  model_id: string;
  modality: Modality;
  audioDataUri?: string | null;
}

/** Issues a synchronous Replicate prediction probe, retrying once against the
 *  alternate input key on a 422 (wrong input shape). */
export async function probeReplicate(
  opts: ProbeReplicateOptions,
): Promise<{ status: number; body: string }> {
  const { model_id, modality, audioDataUri } = opts;

  if (modality === "tts") {
    const first = await postPrediction(model_id, { text: "hi" });
    if (first.status === 422) return postPrediction(model_id, { prompt: "hi" });
    return first;
  }

  if (modality === "stt") {
    if (!audioDataUri) {
      return { status: 0, body: "no audio fixture available for STT probe" };
    }
    const first = await postPrediction(model_id, { audio: audioDataUri });
    if (first.status === 422) return postPrediction(model_id, { audio_file: audioDataUri });
    return first;
  }

  return { status: 0, body: `unsupported modality for replicate probe: ${modality}` };
}
