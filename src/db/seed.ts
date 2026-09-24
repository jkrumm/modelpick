import { sql } from "drizzle-orm";
import { db } from "./index.js";
import { deployment, models, stackChoice } from "./schema.js";
import type { ModelInsert, StackChoiceInsert } from "./schema.js";
import { IU_CATALOG } from "./iu-catalog.js";
import { REPLICATE_CATALOG } from "./replicate-catalog.js";
import { DEPLOYMENTS } from "./deployments.js";

// The model catalog is the IU self-service portal export, parsed into
// src/db/iu-catalog.ts by scripts/import-portal.ts. The live /v1/models aliases
// (tts, tts-hd, whisper, …) are merged in at probe time. Re-run import-portal
// with a fresh HTML export to refresh the catalog.
export async function seedModels(): Promise<void> {
  if (IU_CATALOG.length === 0) return;
  await db
    .insert(models)
    .values(IU_CATALOG)
    .onConflictDoUpdate({
      target: models.id,
      set: {
        provider: sql`excluded.provider`,
        family: sql`excluded.family`,
        modality: sql`excluded.modality`,
        display_name: sql`excluded.display_name`,
        context_window: sql`excluded.context_window`,
        iu_listed: sql`excluded.iu_listed`,
        transport: sql`excluded.transport`,
      },
    });
}

// The Replicate speech-model catalog, parsed into src/db/replicate-catalog.ts
// by scripts/import-replicate.ts. Re-run it to refresh.
export async function seedReplicateModels(): Promise<void> {
  if (REPLICATE_CATALOG.length === 0) return;
  await db
    .insert(models)
    .values(REPLICATE_CATALOG)
    .onConflictDoUpdate({
      target: models.id,
      set: {
        provider: sql`excluded.provider`,
        family: sql`excluded.family`,
        modality: sql`excluded.modality`,
        display_name: sql`excluded.display_name`,
        context_window: sql`excluded.context_window`,
        iu_listed: sql`excluded.iu_listed`,
        transport: sql`excluded.transport`,
      },
    });
}

// Models we genuinely depend on that the IU portal export cannot contain,
// because they are not on the IU endpoint at all. `iu_listed: false` is the
// existing marker for "catalogued but not IU-served" (the collectors already
// create such rows for leaderboard-only comparison entries). Without these,
// a real deployment slot reads as pointed at a nonexistent model.
const EXTERNAL_MODELS: ModelInsert[] = [
  {
    id: "grok-4.20-reasoning",
    provider: "xai",
    family: "grok",
    modality: "llm",
    display_name: "Grok 4.20 Reasoning",
    iu_listed: false,
    transport: "iu",
  },
];

export async function seedExternalModels(): Promise<void> {
  await db
    .insert(models)
    .values(EXTERNAL_MODELS)
    .onConflictDoUpdate({
      target: models.id,
      set: { display_name: sql`excluded.display_name`, iu_listed: sql`excluded.iu_listed` },
    });
}

// My current, deliberately-chosen stack — kept separate from the algorithmic
// `recommendation`. The /stack page diffs the two to flag review-worthy drift.
// Revise the picks here (and bump `decided_at`) when a choice actually changes.
const MY_STACK: StackChoiceInsert[] = [
  {
    category: "fast",
    model_id: "deepseek-v4.1-flash",
    env_note:
      "The estate's default for small and mid-size work at reasoning_effort: high — Hermes brain/delegation/compression, research-gateway lead+worker, audio-gateway podcast outline/editorial/metadata/research, warden propose_mappings, argo ai-gateway, image-gen enhance. gpt-5.6-luna stays only for latency-critical tiny calls (TTS prep, titles), where DeepSeek's 14.9x-uncached warm-turn cost is the wrong tradeoff.",
    rationale:
      "Owner decision, 2026-09-13 (docs/decisions/hermes-brain.md §2026-09-13): capability over cost. V4.1 tops Luna's ceiling (39.5 vs 37.5 AA intelligence at max effort) and consolidating one model across every mid-size lane means a future swap is one id per service rather than a per-slot argument — accepted knowingly with, as understood at the time, no prompt caching on this route (~15x Luna per warm turn on long prefixes, ~$0.85 vs ~$0.06 per 90-turn Hermes conversation). Supersedes the 2026-09-12 caching-driven verdict for Luna, which stands as the losing side of the same measurement, not as a mistake. CORRECTION 2026-09-24: prompt caching does work on this IU OpenAI-compatible route — a direct probe re-sending a 7780-token prefix got cached_tokens 7552, cost per call falling from $0.0011682 to $0.000058 (gateway rates $0.15/MTok in, $0.60 out, ~$0.003 cache read). The 2026-09-12 no-caching reading was wrong; the capability-over-cost verdict itself stands unchanged.",
    decided_at: "2026-09-13",
  },
  {
    category: "coding",
    model_id: "glm-5.3-flash",
    env_note:
      "The unattended worker: sideclaw's iu backend (CLASSIFY tier at MAX_THINKING_TOKENS 2048, AGENT/dispatch tier at 8192), rd bg, agent-dispatch, warden auto investigate/implement, batch jobs. Implementation work now defaults to sideclaw dispatch (config/global.CLAUDE.md) rather than a live-tree subagent. Interactive Claude Code over IU (the ca launcher) runs claude-sonnet-5 instead. Budget on IDLE, not wall clock — this model's honest time on hard agentic work is minutes per turn, and a fixed wall-clock kill reports working sessions as failures. MAX_THINKING_TOKENS is the only reasoning-effort control that reaches this leg (unset defaults to GLM's `max`, its worst setting) — 8192 for agentic/implementation lanes, 2048 for classify-shaped ones. Requesty hop, residency 'global' — non-sensitive code only.",
    rationale:
      "ccbench 2026-09-11: 10/10 on every task once the per-task clock stops being the experiment (--timeout-scale 3, $0.048 per suite). At 1x it appeared to fail 4 of 10, but every one of those landed exactly on its timeout budget and three still scored 1.00 — the harness killed work in progress. Best AA coding index (71.5) and DeepSWE (0.634, above claude-sonnet-5's 0.538) in the Anthropic-route field, at 16-48x less than DeepSeek-V4-Pro per suite. minimax-m3 aces ccbench but is the weakest reasoner measured (OTIS AIME 0.267 vs 0.939); DeepSeek-V4-Pro is the pick when wall clock is what you are paying for. See docs/decisions/claude-code-model.md.",
    decided_at: "2026-09-11",
  },
  {
    category: "writing",
    model_id: "claude-opus-4-6",
    rationale: "See docs/decisions/writing-model.md.",
    decided_at: "2026-09-11",
  },
  {
    category: "orchestrator",
    model_id: "claude-fable-5-1",
    env_note:
      "Fable 5.1 in Claude Code (Max plan — no per-token cost). Opus 5 before it, Opus 4.8 before that; GPT-5.5 dropped as too expensive via IU.",
    rationale:
      "Tops the orchestrator profile, and separately tops LMArena creative writing (1508.8, above claude-opus-4-6's 1504.5) — so the model holding the plan is also the strongest prose model available on Max. Runs on the subscription, so capability dominates with no marginal token cost.",
    decided_at: "2026-09-12",
  },
  {
    category: "tts",
    model_id: "elevenlabs/flash-v2.5",
    env_note:
      "Mark voice, via the IU Replicate route. elevenlabs/v3 for briefings (prep LLM + tags).",
    rationale:
      "Chat path: ~1.2 s per reply vs ~10 s on Gemini 3.1 Flash TTS once the prep LLM is counted; Hermes streams sentence-by-sentence so per-request latency is what the ear hears. v3 (AA #5, tags, previous/next_text continuity) takes the long-form lane. US-routed — accepted for reply text, not for recorded voice. See docs/decisions/audio-stack.md.",
    decided_at: "2026-08-26",
  },
  {
    category: "stt",
    model_id: "gpt-4o-transcribe",
    rationale: "Most accurate IU STT; Whisper kept only for timestamps/verbose_json.",
    decided_at: "2026-05-25",
  },
  // Manual categories — no leaderboard scores these, so there is no algorithmic
  // recommendation and no drift flag. Rationale is research-backed; refresh via
  // /research + /investigate-models when revisiting.
  {
    category: "embedding",
    model_id: "text-embedding-3-small",
    env_note:
      "Use dimensions=512 (Matryoshka) for ~3x storage/latency savings at ~1% quality loss. Residency unverified on IU — for non-sensitive RAG; switch to text-embedding-3-large (EU-confirmed) when residency is required.",
    rationale:
      "Best small embedder on speed + price + quality: $0.02/1M (joint-cheapest), MTEB 62.3, lowest API latency, native Matryoshka truncation. text-embedding-3-large ranks below cheaper models on domain retrieval — 'large' buys size, not quality.",
    decided_at: "2026-06-17",
  },
  {
    category: "vision",
    model_id: "gemini-3.5-flash",
    env_note:
      "Used by sideclaw read_image/read_drawing. Non-EU vendor — fine for git-committed/non-sensitive images. Enable context caching ($0.15/M, 90% off) for repeated document reads.",
    rationale:
      "Best flash-tier vision model for document/chart/diagram reading: tops Roboflow Vision Evals across 67 prompts; AA quality 50 vs GPT-5.4-mini's 17 (the cheaper option is a false economy for structured extraction). $1.50/$9.00 per 1M, 155 tok/s.",
    decided_at: "2026-06-17",
  },
  {
    category: "image",
    model_id: "gpt-image-2.5-flare",
    env_note:
      "Paired with gpt-image-2.5-sunburst (same price and tokens, slower, better edit precision) for edits and high+ finals. Per 1024x1024: low $0.006, medium $0.013, high $0.053, xhigh $0.094, max $0.211. Real alpha transparency on png/webp.",
    rationale:
      "Successor to gpt-image-2 (the June arena leader): the 2.5 pair was live-probed on the IU OpenAI leg 2026-09-23. It makes high about 4x cheaper than gpt-image-2 high and adds the transparency gpt-image-2 never had. Flare is the default because it is the faster of two otherwise identically priced models; image-gen routes edits and finals to sunburst.",
    decided_at: "2026-09-23",
  },
];

// Upsert my picks keyed on category (one row per category). Re-runnable.
export async function seedStack(): Promise<void> {
  await db
    .insert(stackChoice)
    .values(MY_STACK)
    .onConflictDoUpdate({
      target: stackChoice.category,
      set: {
        model_id: sql`excluded.model_id`,
        env_note: sql`excluded.env_note`,
        rationale: sql`excluded.rationale`,
        decided_at: sql`excluded.decided_at`,
      },
    });
}

// Upsert the deployment truth table, keyed on (service, slot). Re-runnable.
// Rows are deleted-then-inserted rather than upserted alone, because a slot
// that disappears from a service's config must disappear here too — a stale
// row claiming a job still runs is worse than no row at all.
export async function seedDeployments(): Promise<void> {
  await db.delete(deployment);
  await db.insert(deployment).values(DEPLOYMENTS);
}
