import { iuFetch } from "./client.js";
import type { ModelInsert, Modality } from "../../db/schema.js";

// Raw shape from the IU /models endpoint (OpenAI-compatible list).
interface IuModelRaw {
  id: string;
  owned_by?: string;
  created?: number;
}

/** Classifies an IU model id into a catalog modality by id heuristics.
 *  Order matters: more specific audio/vision patterns win before the llm default. */
export function classifyModality(id: string): Modality {
  const s = id.toLowerCase();
  if (/embedding|embed|ada-002/.test(s)) return "embedding";
  if (/transcribe|whisper|(^|[-/])stt(-|$)/.test(s)) return "stt";
  if (/(^|[-/])tts(-|$)|text-to-speech|-audio|gpt-realtime|voice/.test(s)) {
    return "tts";
  }
  if (/dall-e|dalle|gpt-image|[-/]image|imagen|stable-diffusion|sdxl|flux|ocr/.test(s)) {
    return "image";
  }
  return "llm";
}

/** Maps an IU model id to a canonical provider key (aligned with chart series colors). */
export function deriveProvider(id: string): string {
  const s = id.toLowerCase();
  if (/^claude|anthropic/.test(s)) return "anthropic";
  if (/^(gpt|o1|o3|o4|chatgpt|dall-e|text-embedding|tts|whisper)/.test(s)) {
    return "openai";
  }
  if (/^gemini|google/.test(s)) return "google";
  if (/^llama|meta/.test(s)) return "meta";
  if (/^qwen|qwq/.test(s)) return "qwen";
  if (/deepseek/.test(s)) return "deepseek";
  if (s.startsWith("phi")) return "microsoft";
  if (/^cohere|command-r/.test(s)) return "cohere";
  if (s.startsWith("jamba")) return "ai21";
  if (/^mistral|mixtral|dolphin/.test(s)) return "mistral";
  if (s.startsWith("iu-")) return "iu";
  const seg = id.includes("/") ? id.split("/")[0] : "";
  return seg ? seg.toLowerCase() : "other";
}

/** Builds a readable display name from a raw model id. */
export function prettifyName(id: string): string {
  const base = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\bgpt\b/gi, "GPT")
    .replace(/\bllm\b/gi, "LLM")
    .replace(/\btts\b/gi, "TTS")
    .replace(/\bhd\b/gi, "HD")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractModels(raw: unknown): IuModelRaw[] {
  if (Array.isArray(raw)) return raw as IuModelRaw[];
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["data"])) return obj["data"] as IuModelRaw[];
    if (Array.isArray(obj["models"])) return obj["models"] as IuModelRaw[];
  }
  return [];
}

/** Fetches the live IU /models list and maps it to catalog model rows. */
export async function discoverIuModels(): Promise<ModelInsert[]> {
  const resp = await iuFetch<unknown>("/models", { method: "GET" });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`IU /models returned HTTP ${resp.status}`);
  }

  const raw = extractModels(resp.body);
  return raw.map((m) => ({
    id: m.id,
    provider: deriveProvider(m.id),
    family: null,
    modality: classifyModality(m.id),
    display_name: prettifyName(m.id),
    context_window: null,
    iu_listed: true,
  }));
}
