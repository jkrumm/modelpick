import { and, desc, eq } from "drizzle-orm";
import { db } from "./index.js";
import {
  capabilityProbe,
  demo,
  models,
  newsItem,
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
  Recommendation,
  StackChoice,
  Demo,
  NewsItem,
} from "./schema.js";

export type { Model, CapabilityProbe, MetricSnapshot, Recommendation, StackChoice, Demo, NewsItem };

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

// ── Audio demos ───────────────────────────────────────────────────────────────

export async function getPublicDemos(modality?: Modality): Promise<Demo[]> {
  if (modality !== undefined) {
    return db
      .select()
      .from(demo)
      .where(and(eq(demo.public, true), eq(demo.modality, modality)))
      .orderBy(desc(demo.created_at));
  }
  return db.select().from(demo).where(eq(demo.public, true)).orderBy(desc(demo.created_at));
}

// ── Admin demo operations ─────────────────────────────────────────────────────

/** Returns all demos for a modality, including non-public ones (admin use). */
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

// ── News ──────────────────────────────────────────────────────────────────────

export async function getReasonableNews(limit = 20): Promise<NewsItem[]> {
  return db
    .select()
    .from(newsItem)
    .where(eq(newsItem.reasonable, true))
    .orderBy(desc(newsItem.published_at))
    .limit(limit);
}

export async function getAllNewsItems(limit = 100): Promise<NewsItem[]> {
  return db.select().from(newsItem).orderBy(desc(newsItem.published_at)).limit(limit);
}

export interface NewsItemInsert {
  title: string;
  url: string;
  source: string;
  summary?: string | null;
  published_at?: string | null;
  model_id?: string | null;
  reasonable?: boolean;
}

/**
 * Insert a news item; returns true if inserted, false if the URL already exists.
 * Uses ON CONFLICT DO NOTHING on the unique url index for idempotent daily runs.
 */
export async function upsertNewsItem(data: NewsItemInsert): Promise<boolean> {
  const rows = await db
    .insert(newsItem)
    .values({
      title: data.title,
      url: data.url,
      source: data.source,
      summary: data.summary ?? null,
      published_at: data.published_at ?? null,
      model_id: data.model_id ?? null,
      reasonable: data.reasonable ?? true,
    })
    .onConflictDoNothing()
    .returning({ id: newsItem.id });
  return rows.length > 0;
}
