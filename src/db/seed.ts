import { sql } from "drizzle-orm";
import { db } from "./index.js";
import { deployment, models, stackChoice } from "./schema.js";
import type { ModelInsert } from "./schema.js";
import { MY_STACK } from "../stack.js";
import { IU_CATALOG } from "./iu-catalog.js";
import { REPLICATE_CATALOG } from "./replicate-catalog.js";
import { DEPLOYMENTS } from "./deployments.js";
import { DECISION_CATALOG } from "./decision-models.js";

// The model catalog is the IU gateway's live per-leg /models listings, merged into
// src/db/iu-catalog.ts by scripts/sync-catalog.ts (`make models`, step 0 of refresh).
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
        owned_by: sql`excluded.owned_by`,
        legs: sql`excluded.legs`,
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

// Models we genuinely depend on that the IU /models listings cannot contain,
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

// Decision models (src/db/decision-models.ts). The upsert flips `clef` & co. from
// the `llm` the discovery of older probes gave them to `decision`, and adds the
// two ids /models never lists (jev-*, and Luna's Decisions route as its own entry
// so the gpt-6-luna chat row stays untouched).
export async function seedDecisionModels(): Promise<void> {
  await db
    .insert(models)
    .values(DECISION_CATALOG)
    .onConflictDoUpdate({
      target: models.id,
      set: {
        provider: sql`excluded.provider`,
        family: sql`excluded.family`,
        modality: sql`excluded.modality`,
        display_name: sql`excluded.display_name`,
      },
    });
}

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
