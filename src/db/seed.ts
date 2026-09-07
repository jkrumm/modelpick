import { sql } from "drizzle-orm";
import { db } from "./index.js";
import { models, stackChoice } from "./schema.js";
import type { StackChoiceInsert } from "./schema.js";
import { IU_CATALOG } from "./iu-catalog.js";
import { REPLICATE_CATALOG } from "./replicate-catalog.js";

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

// My current, deliberately-chosen stack — kept separate from the algorithmic
// `recommendation`. The /stack page diffs the two to flag review-worthy drift.
// Revise the picks here (and bump `decided_at`) when a choice actually changes.
const MY_STACK: StackChoiceInsert[] = [
  {
    category: "fast",
    model_id: "DeepSeek-V4-Flash",
    env_note: "Residency unverified (probe: unknown) — not yet confirmed EU.",
    rationale:
      "Beats gpt-5.4-nano on the fast profile: ~6x cheaper output, sub-second TTFT, higher quality (AA 46.5 vs 44.0), 1M context.",
    decided_at: "2026-06-02",
  },
  {
    category: "coding",
    model_id: "glm-5.3-flash",
    env_note:
      "The unattended worker: sideclaw's iu backend, rd bg, batch jobs. Interactive Claude Code over IU (the ca launcher, agent-dispatch) runs claude-sonnet-5 instead — 35% faster on wall clock, 32x the price. ccbench (bun run bench) is the gate; /stack diffs this pick against its worker and interactive picks.",
    rationale:
      "ccbench 2026-08-31: perfect score on all ten tasks at $0.035 per suite against claude-sonnet-5's $1.127, and above it on the AA coding index. Its two timeouts were the clock, not capability (13 tok/s on this route; retest 4/4). DeepSeek-V4-Flash, the previous pick, dropped 16% of tool calls on the same suite. See docs/decisions/claude-code-model.md.",
    decided_at: "2026-08-31",
  },
  {
    category: "orchestrator",
    model_id: "claude-opus-5",
    env_note:
      "Opus 5 in Claude Code (Max plan — no per-token cost). Replaced Opus 4.8 on release; GPT-5.5 before that, dropped as too expensive via IU.",
    rationale:
      "Tops the orchestrator profile (recommender score 0.898, ahead of claude-opus-4-8). Runs on the Max subscription in Claude Code, so capability dominates with no marginal token cost — unlike GPT-5.5 via IU.",
    decided_at: "2026-08-02",
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
    model_id: "gpt-image-2",
    env_note:
      "Quality tiers: Low $0.005 (prompt iteration), Medium ~$0.05 (production), High $0.21 (hero/4K). For photorealism or 4-6x faster generation, use gemini-3.1-flash-image instead.",
    rationale:
      "Outright image-generation leader: sweeps LMArena Image Arena (+242 ELO in text-to-image, 1512 vs 1270), #1 on single/multi-image edit, near-perfect in-image text. dall-e-3 and gpt-image-1 are deprecated.",
    decided_at: "2026-06-17",
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
