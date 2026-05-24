// Pure data — no DB dependency. Mirrors MODEL_SEED in seed.ts.
// Keep in sync when adding models to the seed.
export const LOCAL_MODEL_IDS: string[] = [
  // LLM
  "Kimi-K2.6",
  "gpt-5.5",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "claude-opus-4-7",
  "claude-opus-4-7-eu",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-eu",
  "claude-haiku-4-5",
  "claude-haiku-4-5-eu",
  "GLM-5",
  "DeepSeek-V3.2",
  "Qwen3-Coder-480B",
  "MiniMax-M2.5",
  // TTS
  "tts",
  "tts-hd",
  "gpt-4o-mini-tts",
  "gemini-2.5-flash-tts",
  "voxtral-mini-tts",
  // STT
  "whisper",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe-diarize",
  "voxtral-mini-transcribe",
];
