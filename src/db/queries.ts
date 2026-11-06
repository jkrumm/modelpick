import { and, desc, eq } from "drizzle-orm";
import { db } from "./index.js";
import { capabilityProbe, demo, models } from "./schema.js";
import type { Modality, Lang, Model, ProbeStatus, Residency, Demo } from "./schema.js";

export type { Model, Demo };

// ── Models ────────────────────────────────────────────────────────────────────

export async function getModels(modality?: Modality): Promise<Model[]> {
  if (modality !== undefined) {
    return db.select().from(models).where(eq(models.modality, modality));
  }
  return db.select().from(models);
}

// ── Capability probes (shared latest-per-model lookup) ────────────────────────

export interface ProbeSummary {
  accessible: boolean;
  probe_status: ProbeStatus;
  error: string | null;
  latency_ms: number | null;
  residency: Residency;
}

/** Latest capability_probe row per model, newest `checked_at` first — the one
 *  lookup both the alerts and the efficiency feed read access/residency
 *  from, so a probe's shape only gets deduplicated in one place. */
export async function getLatestProbes(): Promise<Record<string, ProbeSummary>> {
  const rows = await db
    .select({
      model_id: capabilityProbe.model_id,
      accessible: capabilityProbe.accessible,
      probe_status: capabilityProbe.probe_status,
      error: capabilityProbe.error,
      latency_ms: capabilityProbe.latency_ms,
      residency: capabilityProbe.residency,
      checked_at: capabilityProbe.checked_at,
    })
    .from(capabilityProbe)
    .orderBy(desc(capabilityProbe.checked_at));

  const map = new Map<string, ProbeSummary>();
  for (const row of rows) {
    if (map.has(row.model_id)) continue;
    map.set(row.model_id, {
      accessible: row.accessible,
      probe_status: row.probe_status,
      error: row.error,
      latency_ms: row.latency_ms,
      residency: row.residency,
    });
  }
  return Object.fromEntries(map);
}

// ── Demo operations ────────────────────────────────────────────────────────────

/** Returns all demos for a modality. `public` marks which ones are shown in the
 *  default shortlist (see the TTS/STT playground's "Show disabled" toggle). */
export async function getAllDemos(modality?: Modality): Promise<Demo[]> {
  if (modality !== undefined) {
    return db.select().from(demo).where(eq(demo.modality, modality)).orderBy(desc(demo.created_at));
  }
  return db.select().from(demo).orderBy(desc(demo.created_at));
}

export interface DemoInsert {
  modality: Modality;
  model_id: string;
  text_content: string;
  lang: Lang;
  preset?: string | null;
  voice?: string | null;
  audio_path?: string | null;
  public?: boolean;
}

export async function insertDemo(data: DemoInsert): Promise<Demo> {
  const rows = await db.insert(demo).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("insertDemo returned no rows");
  return row;
}

export async function updateDemoAudioPath(id: number, audioPath: string): Promise<void> {
  await db.update(demo).set({ audio_path: audioPath }).where(eq(demo.id, id));
}

export async function setDemoPublic(id: number, isPublic: boolean): Promise<void> {
  await db.update(demo).set({ public: isPublic }).where(eq(demo.id, id));
}

/** Bulk enable/disable every demo of a given voice (used to narrow the TTS
 *  candidate shortlist). Scoped to a modality so STT/TTS don't collide. */
export async function setDemoPublicByVoice(
  modality: Modality,
  voice: string,
  isPublic: boolean,
): Promise<void> {
  await db
    .update(demo)
    .set({ public: isPublic })
    .where(and(eq(demo.modality, modality), eq(demo.voice, voice)));
}
