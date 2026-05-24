import { db } from "./index.js";
import { models } from "./schema.js";
import type { ModelInsert } from "./schema.js";

// Verified model inventory from iu-multimodal-exploration.md (2026-05-22).
// Re-confirmed by live probes in Group 4; update residency/context as new data arrives.
export const MODEL_SEED: ModelInsert[] = [
  // ── LLM models ──────────────────────────────────────────────────────────
  {
    id: "Kimi-K2.6",
    provider: "moonshot",
    family: "kimi-k2",
    modality: "llm",
    display_name: "Kimi K2.6",
    context_window: 128000,
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    family: "gpt-5",
    modality: "llm",
    display_name: "GPT-5.5",
    context_window: 128000,
  },
  {
    id: "gemini-3-pro-preview",
    provider: "google",
    family: "gemini-3",
    modality: "llm",
    display_name: "Gemini 3 Pro Preview",
    context_window: 1000000,
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    family: "gemini-3",
    modality: "llm",
    display_name: "Gemini 3 Flash Preview",
    context_window: 1000000,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Opus 4.7",
    context_window: 200000,
  },
  {
    id: "claude-opus-4-7-eu",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Opus 4.7 (EU)",
    context_window: 200000,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Sonnet 4.6",
    context_window: 200000,
  },
  {
    id: "claude-sonnet-4-6-eu",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Sonnet 4.6 (EU)",
    context_window: 200000,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Haiku 4.5",
    context_window: 200000,
  },
  {
    id: "claude-haiku-4-5-eu",
    provider: "anthropic",
    family: "claude-4",
    modality: "llm",
    display_name: "Claude Haiku 4.5 (EU)",
    context_window: 200000,
  },
  {
    id: "GLM-5",
    provider: "zhipu",
    family: "glm",
    modality: "llm",
    display_name: "GLM-5",
    context_window: 128000,
  },
  {
    id: "DeepSeek-V3.2",
    provider: "deepseek",
    family: "deepseek-v3",
    modality: "llm",
    display_name: "DeepSeek V3.2",
    context_window: 64000,
  },
  {
    id: "Qwen3-Coder-480B",
    provider: "alibaba",
    family: "qwen3",
    modality: "llm",
    display_name: "Qwen3 Coder 480B",
    context_window: 131072,
  },
  {
    id: "MiniMax-M2.5",
    provider: "minimax",
    family: "minimax-m2",
    modality: "llm",
    display_name: "MiniMax M2.5",
    context_window: 1000000,
  },
  // ── TTS models ──────────────────────────────────────────────────────────
  {
    id: "tts",
    provider: "openai",
    family: "tts",
    modality: "tts",
    display_name: "TTS (Azure Sweden EU)",
  },
  {
    id: "tts-hd",
    provider: "openai",
    family: "tts",
    modality: "tts",
    display_name: "TTS HD (Azure Sweden EU)",
  },
  {
    id: "gpt-4o-mini-tts",
    provider: "openai",
    family: "gpt-4o",
    modality: "tts",
    display_name: "GPT-4o Mini TTS",
  },
  {
    id: "gemini-2.5-flash-tts",
    provider: "google",
    family: "gemini-2.5",
    modality: "tts",
    display_name: "Gemini 2.5 Flash TTS",
  },
  {
    id: "voxtral-mini-tts",
    provider: "mistral",
    family: "voxtral",
    modality: "tts",
    display_name: "Voxtral Mini TTS",
  },
  // ── STT models ──────────────────────────────────────────────────────────
  {
    id: "whisper",
    provider: "openai",
    family: "whisper",
    modality: "stt",
    display_name: "Whisper (Azure Sweden EU)",
  },
  {
    id: "gpt-4o-transcribe",
    provider: "openai",
    family: "gpt-4o",
    modality: "stt",
    display_name: "GPT-4o Transcribe",
  },
  {
    id: "gpt-4o-mini-transcribe",
    provider: "openai",
    family: "gpt-4o",
    modality: "stt",
    display_name: "GPT-4o Mini Transcribe",
  },
  {
    id: "gpt-4o-transcribe-diarize",
    provider: "openai",
    family: "gpt-4o",
    modality: "stt",
    display_name: "GPT-4o Transcribe (Diarization)",
  },
  {
    id: "voxtral-mini-transcribe",
    provider: "mistral",
    family: "voxtral",
    modality: "stt",
    display_name: "Voxtral Mini Transcribe",
  },
];

export async function seedModels(): Promise<void> {
  await db.insert(models).values(MODEL_SEED).onConflictDoNothing();
}
