import type { StackChoiceInsert } from "./db/schema.js";

/**
 * The one place that says which model to use for which job. STACK.md at the repo
 * root is rendered from this (`make stack`); `seedStack` writes the first entry
 * of each category into `stack_choice`, which the /stack page diffs against the
 * algorithm's recommendation. Revise a pick here (and bump `decided_at`) when a
 * choice actually changes, then run `make stack`.
 */
export interface StackEntry extends StackChoiceInsert {
  /** The job the owner actually has, e.g. "TTS chat". */
  job: string;
  /** Reasoning effort / voice / other non-default settings. */
  settings: string;
  /** The IU leg it runs on (iu-openai, iu-anthropic, iu-gemini, iu-decisions) or the subscription. */
  leg: string;
  /** One line; the long form is `rationale`. */
  why: string;
  /** docs/decisions/*.md backing the pick. */
  decision_doc?: string;
}

const ENTRIES: StackEntry[] = [
  {
    job: "Estate default / fast",
    category: "fast",
    model_id: "deepseek-v4.1-flash",
    settings: "reasoning_effort high",
    leg: "iu-openai",
    why: "Capability over cost: one mid-size model across every service.",
    decision_doc: "docs/decisions/hermes-brain.md",
    env_note:
      "The estate's default for small and mid-size work at reasoning_effort: high — Hermes brain/delegation/compression, research-gateway lead+worker, audio-gateway podcast outline/editorial/metadata/research, warden propose_mappings, argo ai-gateway, image-gen enhance. gpt-5.6-luna stays only for latency-critical tiny calls (TTS prep, titles), where DeepSeek's 14.9x-uncached warm-turn cost is the wrong tradeoff.",
    rationale:
      "Owner decision, 2026-09-13 (docs/decisions/hermes-brain.md §2026-09-13): capability over cost. V4.1 tops Luna's ceiling (39.5 vs 37.5 AA intelligence at max effort) and consolidating one model across every mid-size lane means a future swap is one id per service rather than a per-slot argument — accepted knowingly with, as understood at the time, no prompt caching on this route (~15x Luna per warm turn on long prefixes, ~$0.85 vs ~$0.06 per 90-turn Hermes conversation). Supersedes the 2026-09-12 caching-driven verdict for Luna, which stands as the losing side of the same measurement, not as a mistake. CORRECTION 2026-09-24: prompt caching does work on this IU OpenAI-compatible route — a direct probe re-sending a 7780-token prefix got cached_tokens 7552, cost per call falling from $0.0011682 to $0.000058 (gateway rates $0.15/MTok in, $0.60 out, ~$0.003 cache read). The 2026-09-12 no-caching reading was wrong; the capability-over-cost verdict itself stands unchanged.",
    decided_at: "2026-09-13",
  },
  {
    job: "Coding (unattended worker)",
    category: "coding",
    model_id: "glm-5.3-flash",
    settings: "MAX_THINKING_TOKENS 2048 classify / 8192 agent",
    leg: "iu-anthropic",
    why: "10/10 on ccbench, best AA coding index in the Anthropic-route field at a fraction of the cost.",
    decision_doc: "docs/decisions/claude-code-model.md",
    env_note:
      "The unattended worker: agent-gateway's iu backend (CLASSIFY tier at MAX_THINKING_TOKENS 2048, AGENT/dispatch tier at 8192), rd bg, agent-dispatch, warden auto investigate/implement, batch jobs. Implementation work now defaults to agw dispatch (config/global.CLAUDE.md) rather than a live-tree subagent. Interactive Claude Code over IU (the ca launcher) runs claude-sonnet-5 instead. Budget on IDLE, not wall clock — this model's honest time on hard agentic work is minutes per turn, and a fixed wall-clock kill reports working sessions as failures. MAX_THINKING_TOKENS is the only reasoning-effort control that reaches this leg (unset defaults to GLM's `max`, its worst setting) — 8192 for agentic/implementation lanes, 2048 for classify-shaped ones. Requesty hop, residency 'global' — non-sensitive code only.",
    rationale:
      "ccbench 2026-09-11: 10/10 on every task once the per-task clock stops being the experiment (--timeout-scale 3, $0.048 per suite). At 1x it appeared to fail 4 of 10, but every one of those landed exactly on its timeout budget and three still scored 1.00 — the harness killed work in progress. Best AA coding index (71.5) and DeepSWE (0.634, above claude-sonnet-5's 0.538) in the Anthropic-route field, at 16-48x less than DeepSeek-V4-Pro per suite. minimax-m3 aces ccbench but is the weakest reasoner measured (OTIS AIME 0.267 vs 0.939); DeepSeek-V4-Pro is the pick when wall clock is what you are paying for. See docs/decisions/claude-code-model.md.",
    decided_at: "2026-09-11",
  },
  {
    job: "Writing",
    category: "writing",
    model_id: "claude-opus-5-5",
    settings: "adaptive thinking",
    leg: "iu-anthropic",
    why: "Voice owner for prose; wins the Arena creative-writing comparison.",
    decision_doc: "docs/decisions/writing-model.md",
    env_note:
      "Voice owner for prose: agent-gateway's prose tool (prose_write) and the default for long-form writing against brain/voice.md. The podcast voice owner (audio-gateway PODCAST_WRITE_MODEL) runs it too, on the native Anthropic wire with adaptive thinking (2026-10-19).",
    rationale: "See docs/decisions/writing-model.md.",
    decided_at: "2026-10-17",
  },
  {
    job: "Orchestrator",
    category: "orchestrator",
    model_id: "claude-fable-5-1",
    settings: "Max plan default",
    leg: "max subscription",
    why: "Tops the orchestrator profile and runs on the subscription, so capability dominates.",
    decision_doc: "docs/decisions/execution-modes.md",
    env_note:
      "Fable 5.1 in Claude Code (Max plan — no per-token cost). Opus 5 before it, Opus 4.8 before that; GPT-5.5 dropped as too expensive via IU.",
    rationale:
      "Tops the orchestrator profile, and separately tops LMArena creative writing (1508.8, above claude-opus-4-6's 1504.5) — so the model holding the plan is also the strongest prose model available on Max. Runs on the subscription, so capability dominates with no marginal token cost.",
    decided_at: "2026-09-12",
  },
  {
    job: "TTS chat",
    category: "tts",
    model_id: "gemini-3.8-flash-lite-tts",
    settings: "voice Charon, streamed PCM, prep off",
    leg: "iu-gemini",
    why: "AA TTS Elo #8 with sub-1.1 s first audio, one vendor for all lanes.",
    decision_doc: "docs/decisions/audio-stack.md",
    env_note:
      "Charon, via audio-gateway. Chat = gemini-3.8-flash-lite-tts (streamed PCM, prep off); briefings = gemini-3.8-flash-tts (prep on); podcasts = gemini-3.8-flash-tts multi-speaker (Charon + Erinome). elevenlabs/v3 and flash-v2.5 stay as model-id fallbacks.",
    rationale:
      "Owner decision 2026-10-25 after the TTS field re-check: Gemini 3.8 Flash TTS is AA #5 (lite #8) against ElevenLabs v3 at #21, first audio 0.5-1.1 s streamed, ~$0.009-0.0135/min. One vendor for all three lanes, streaming where the client reads progressively. See docs/decisions/audio-stack.md.",
    decided_at: "2026-10-25",
  },
  {
    job: "TTS long-form (briefings, podcasts)",
    category: "tts",
    model_id: "gemini-3.8-flash-tts",
    settings: "voices Charon + Erinome, prep on",
    leg: "iu-gemini",
    why: "Higher-quality sibling of the chat model; multi-speaker for podcasts.",
    decision_doc: "docs/decisions/audio-stack.md",
    decided_at: "2026-10-25",
  },
  {
    job: "STT",
    category: "stt",
    model_id: "voxtral-mini-transcribe-3-0",
    settings: "auto-detect language; json/text",
    leg: "iu-openai",
    why: "First EU-resident cloud STT matching the US models on German.",
    decision_doc: "docs/decisions/audio-stack.md",
    env_note:
      "audio-gateway default with fallback gpt-transcribe, then whisper (the only one with native timestamps). MacWhisper handles on-device dictation.",
    rationale:
      "Decided 2026-10-25 (docs/decisions/audio-stack.md, German STT comparison): Voxtral mini 6.2% WER on the long German set against gpt-transcribe, EU-resident, $0.0035/min, segment timestamps. gpt-transcribe (2026-10-15 pick) stays as the fallback; gpt-4o-transcribe shuts down 2027-02-26.",
    decided_at: "2026-10-25",
  },
  // Manual categories — no leaderboard scores these, so there is no algorithmic
  // recommendation and no drift flag. Rationale is research-backed; refresh via
  // /research + /investigate-models when revisiting.
  {
    job: "Embedding",
    category: "embedding",
    model_id: "text-embedding-3-small",
    settings: "dimensions=512",
    leg: "iu-openai",
    why: "Joint-cheapest, native Matryoshka truncation.",
    env_note:
      "Use dimensions=512 (Matryoshka) for ~3x storage/latency savings at ~1% quality loss. Residency unverified on IU — for non-sensitive RAG; switch to text-embedding-3-large (EU-confirmed) when residency is required.",
    rationale:
      "Best small embedder on speed + price + quality: $0.02/1M (joint-cheapest), MTEB 62.3, lowest API latency, native Matryoshka truncation. text-embedding-3-large ranks below cheaper models on domain retrieval — 'large' buys size, not quality.",
    decided_at: "2026-06-17",
  },
  {
    job: "Vision",
    category: "vision",
    model_id: "gemini-3.5-flash",
    settings: "context caching for repeated reads",
    leg: "iu-gemini",
    why: "Best flash-tier document/chart reader.",
    decision_doc: "docs/decisions/vision-and-image.md",
    env_note:
      "Used by agent-gateway read_image/read_drawing. Non-EU vendor — fine for git-committed/non-sensitive images. Enable context caching ($0.15/M, 90% off) for repeated document reads.",
    rationale:
      "Best flash-tier vision model for document/chart/diagram reading: tops Roboflow Vision Evals across 67 prompts; AA quality 50 vs GPT-5.4-mini's 17 (the cheaper option is a false economy for structured extraction). $1.50/$9.00 per 1M, 155 tok/s.",
    decided_at: "2026-06-17",
  },
  {
    job: "Image",
    category: "image",
    model_id: "gpt-image-2.5-flare",
    settings: "quality low/medium/high per use",
    leg: "iu-openai",
    why: "Cheap high-quality renders with real alpha.",
    decision_doc: "docs/decisions/vision-and-image.md",
    env_note:
      "Paired with gpt-image-2.5-sunburst (same price and tokens, slower, better edit precision) for edits and high+ finals. Per 1024x1024: low $0.006, medium $0.013, high $0.053, xhigh $0.094, max $0.211. Real alpha transparency on png/webp.",
    rationale:
      "Successor to gpt-image-2 (the June arena leader): the 2.5 pair was live-probed on the IU OpenAI leg 2026-09-23. It makes high about 4x cheaper than gpt-image-2 high and adds the transparency gpt-image-2 never had. Flare is the default because it is the faster of two otherwise identically priced models; image-gen routes edits and finals to sunburst.",
    decided_at: "2026-09-23",
  },
  {
    job: "Decision",
    category: "decision",
    model_id: "pplx-decider-v1-27b",
    settings: "typed yes/no and choice",
    leg: "iu-decisions",
    why: "Only model at 100% on all four decision suites.",
    decision_doc: "docs/decisions/decision-model.md",
    env_note:
      "email-gateway's decision lane (DECISION_MODEL pplx-decider-v1-27b on UE's native systemone API, /decisions/v1/systemone, via @ai-sdk/typesafe-ai): typed yes/no and choice answers with probabilities, no text generation. gpt-6-luna stays the chat model for everything else in that service.",
    rationale:
      "2026-10-13 (docs/decisions/decision-model.md): residency and cost are not criteria (owner). The only model at 100% on all four bench suites incl. the adversarial hard-verdict and the urgency score, Brier 0.0011 (10x the next), hedges on borderline cases (0.74-0.92), and honours the question's 'when unsure, choose legit' rule that jev-latest breaks. No external leaderboard scores decision models, so the recommender never picks here.",
    decided_at: "2026-10-13",
  },
];

export const STACK: readonly StackEntry[] = ENTRIES;

/** One `stack_choice` row per category; the first entry of a category is its primary. */
export const MY_STACK: StackChoiceInsert[] = ENTRIES.filter(
  (e, i) => ENTRIES.findIndex((o) => o.category === e.category) === i,
).map(({ category, model_id, env_note, rationale, decided_at }) => ({
  category,
  model_id,
  env_note,
  rationale,
  decided_at,
}));
