import { sql } from "drizzle-orm";
import { db } from "./index.js";
import { models, stackChoice } from "./schema.js";
import type { StackChoiceInsert } from "./schema.js";
import { IU_CATALOG } from "./iu-catalog.js";

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
      },
    });
}

// My current, deliberately-chosen stack — kept separate from the algorithmic
// `recommendation`. The /stack page diffs the two to flag review-worthy drift.
// Revise the picks here (and bump `decided_at`) when a choice actually changes.
const MY_STACK: StackChoiceInsert[] = [
  {
    category: "fast",
    model_id: "gpt-5.4-nano",
    rationale: "Cheapest capable model for high-volume, latency-sensitive utility calls.",
    decided_at: "2026-05-25",
  },
  {
    category: "coding",
    model_id: "Kimi-K2.6",
    env_note: "Routed via the LiteLLM bridge (Azure Sweden, EU/GDPR) for sideclaw workers.",
    rationale: "Strong coding index at a fraction of frontier cost, EU-resident.",
    decided_at: "2026-05-25",
  },
  {
    category: "orchestrator",
    model_id: "GPT-5.5",
    env_note: "GPT-5.5 via IU for agents; Opus 4.7 (Max) in Claude Code.",
    rationale: "Top reasoning for planning/orchestration where capability dominates cost.",
    decided_at: "2026-05-25",
  },
  {
    category: "tts",
    model_id: "gemini-3.1-flash-tts-preview",
    env_note: "Charon voice.",
    rationale: "Most expressive IU TTS; native generateContent route, EU-resident.",
    decided_at: "2026-05-25",
  },
  {
    category: "stt",
    model_id: "gpt-4o-transcribe",
    rationale: "Most accurate IU STT; Whisper kept only for timestamps/verbose_json.",
    decided_at: "2026-05-25",
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
