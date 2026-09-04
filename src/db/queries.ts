import { and, desc, eq } from "drizzle-orm";
import { db } from "./index.js";
import {
  capabilityProbe,
  demo,
  models,
  recommendation,
  stackChoice,
  metricSnapshot,
} from "./schema.js";
import type {
  Modality,
  RecommendationCategory,
  Lang,
  Model,
  CapabilityProbe,
  MetricSnapshot,
  MetricSource,
  Recommendation,
  StackChoice,
  Demo,
} from "./schema.js";

export type { Model, CapabilityProbe, MetricSnapshot, Recommendation, StackChoice, Demo };

// ── Models ────────────────────────────────────────────────────────────────────

export async function getModels(modality?: Modality): Promise<Model[]> {
  if (modality !== undefined) {
    return db.select().from(models).where(eq(models.modality, modality));
  }
  return db.select().from(models);
}

/** Returns models that were accessible in their most recent probe. */
export async function getAccessibleModels(modality?: Modality): Promise<Model[]> {
  // Subquery not needed: join the latest probe per model via a lateral-style
  // approach — fetch all probes ordered by checked_at desc, deduplicate in TS.
  const probes = await db
    .select({
      model_id: capabilityProbe.model_id,
      accessible: capabilityProbe.accessible,
      checked_at: capabilityProbe.checked_at,
    })
    .from(capabilityProbe)
    .orderBy(desc(capabilityProbe.checked_at));

  // Keep only the latest probe per model
  const latestByModel = new Map<string, { model_id: string; accessible: boolean }>();
  for (const probe of probes) {
    if (!latestByModel.has(probe.model_id)) {
      latestByModel.set(probe.model_id, probe);
    }
  }

  const accessibleIds = [...latestByModel.values()]
    .filter((p) => p.accessible)
    .map((p) => p.model_id);

  if (accessibleIds.length === 0) return [];

  const conditions = modality !== undefined ? eq(models.modality, modality) : undefined;

  const rows = conditions
    ? await db.select().from(models).where(conditions)
    : await db.select().from(models);

  return rows.filter((m) => accessibleIds.includes(m.id));
}

// ── Metric snapshots ──────────────────────────────────────────────────────────

/** Latest metric snapshots, optionally filtered to a specific date (yyyy-mm-dd). */
export async function getLatestMetrics(snapshotDate?: string): Promise<MetricSnapshot[]> {
  const rows = await db.select().from(metricSnapshot).orderBy(desc(metricSnapshot.captured_at));

  if (snapshotDate === undefined) return rows;

  return rows.filter((r) => r.captured_at.startsWith(snapshotDate));
}

/** One (model_id, source, metric) triple at its most recent capture — the
 *  cross-benchmark matrix on /benchmarks reads every metric this way, with no
 *  hardcoded subset, so a newly-collected source shows up without a code change. */
export interface LatestMetric {
  model_id: string;
  source: MetricSource;
  metric: string;
  value: number;
  confidence: number | null;
  captured_at: string;
}

export async function getLatestMetricsBySourceMetric(): Promise<LatestMetric[]> {
  const rows = await db
    .select({
      model_id: metricSnapshot.model_id,
      source: metricSnapshot.source,
      metric: metricSnapshot.metric,
      value: metricSnapshot.value,
      confidence: metricSnapshot.confidence,
      captured_at: metricSnapshot.captured_at,
    })
    .from(metricSnapshot)
    .orderBy(desc(metricSnapshot.captured_at));

  // Rows are already newest-first, so the first hit per composite key is the latest.
  const seen = new Set<string>();
  const result: LatestMetric[] = [];
  for (const row of rows) {
    const key = `${row.model_id}|${row.source}|${row.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendationsByDate(snapshotDate: string): Promise<Recommendation[]> {
  return db
    .select()
    .from(recommendation)
    .where(eq(recommendation.snapshot_date, snapshotDate))
    .orderBy(desc(recommendation.score));
}

export async function getLatestRecommendations(): Promise<Recommendation[]> {
  const all = await db
    .select()
    .from(recommendation)
    .orderBy(desc(recommendation.snapshot_date), desc(recommendation.score));

  if (all.length === 0) return [];

  // Return only entries for the most recent snapshot date
  const latestDate = all[0]?.snapshot_date;
  if (latestDate === undefined) return [];

  return all.filter((r) => r.snapshot_date === latestDate);
}

export async function getRecommendationByCategory(
  category: RecommendationCategory,
  snapshotDate?: string,
): Promise<Recommendation | undefined> {
  if (snapshotDate !== undefined) {
    const rows = await db
      .select()
      .from(recommendation)
      .where(
        and(eq(recommendation.category, category), eq(recommendation.snapshot_date, snapshotDate)),
      )
      .limit(1);
    return rows[0];
  }

  const rows = await db
    .select()
    .from(recommendation)
    .where(eq(recommendation.category, category))
    .orderBy(desc(recommendation.snapshot_date))
    .limit(1);
  return rows[0];
}

// ── My Stack ──────────────────────────────────────────────────────────────────

/** My deliberate model picks, one per category. */
export async function getStackChoices(): Promise<StackChoice[]> {
  return db.select().from(stackChoice);
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
