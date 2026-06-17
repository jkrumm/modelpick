import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// SQLite has no native enum type — Drizzle emits a CHECK constraint from the
// `enum` option and surfaces the union on the inferred type. The value tuples
// are exported so tests and callers can assert against them.
export const MODALITY = ["llm", "tts", "stt", "image", "embedding"] as const;
export const RESIDENCY = ["eu", "us", "unknown"] as const;
// Outcome of a live access probe. `accessible` is derived from this (available|throttled).
export const PROBE_STATUS = [
  "available", // 2xx — model responded
  "throttled", // rate/usage limit — model exists and works, temporarily capped
  "backend_error", // IU-side misconfig: bad upstream key / missing auth / auth failure
  "not_routed", // no provider/backend for this model on the gateway
  "bad_request", // route reached the model but rejected our request shape
  "timeout", // probe aborted before a response
  "unknown", // unclassified non-2xx
] as const;
// Scored categories — driven by the recommender against leaderboard metrics.
export const CATEGORY = ["fast", "coding", "orchestrator", "tts", "stt"] as const;
// Manual stack-only categories: real model choices I track, but with no public
// leaderboard to score them — so they live in My Stack with a researched rationale
// and never get an algorithmic recommendation (hence no drift flag). Refresh the
// rationale via /research + /investigate-models when revisiting the pick.
export const MANUAL_CATEGORY = ["embedding", "vision", "image"] as const;
export const STACK_CATEGORY = [...CATEGORY, ...MANUAL_CATEGORY] as const;
export const LANG = ["de", "en"] as const;
export const METRIC_SOURCE = ["iu", "openrouter", "artificialanalysis"] as const;

// Text timestamp default — SQLite stores ISO-ish strings that sort lexically.
const now = sql`(CURRENT_TIMESTAMP)`;

// ── Models (catalog) ────────────────────────────────────────────────────────
// id is the API-facing model identifier, e.g. 'claude-sonnet-4-6', 'tts-hd'

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  family: text("family"),
  modality: text("modality", { enum: MODALITY }).notNull(),
  display_name: text("display_name").notNull(),
  context_window: integer("context_window"),
  // true when the model is returned by the live IU /models endpoint (vs. an
  // external-only comparison entry discovered from a leaderboard collector)
  iu_listed: integer("iu_listed", { mode: "boolean" }).notNull().default(false),
  created_at: text("created_at").notNull().default(now),
});

// ── Capability probes (IU endpoint access checks) ────────────────────────────

export const capabilityProbe = sqliteTable(
  "capability_probe",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    accessible: integer("accessible", { mode: "boolean" }).notNull(),
    probe_status: text("probe_status", { enum: PROBE_STATUS }).notNull().default("unknown"),
    error: text("error"),
    latency_ms: real("latency_ms"),
    residency: text("residency", { enum: RESIDENCY }).notNull().default("unknown"),
    checked_at: text("checked_at").notNull().default(now),
  },
  (t) => [
    index("idx_capability_probe_model_id").on(t.model_id),
    index("idx_capability_probe_checked_at").on(t.checked_at),
  ],
);

// ── Metric snapshots (quality/price/throughput per source) ───────────────────
// metric values: 'quality' | 'price_in' | 'price_out' | 'throughput' | 'latency_p50'

export const metricSnapshot = sqliteTable(
  "metric_snapshot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    source: text("source", { enum: METRIC_SOURCE }).notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    confidence: real("confidence"),
    captured_at: text("captured_at").notNull().default(now),
  },
  (t) => [
    index("idx_metric_snapshot_model_id").on(t.model_id),
    index("idx_metric_snapshot_captured_at").on(t.captured_at),
    index("idx_metric_snapshot_source_metric").on(t.source, t.metric),
  ],
);

// ── Recommendations (one per category per snapshot date) ─────────────────────

export const recommendation = sqliteTable(
  "recommendation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category: text("category", { enum: CATEGORY }).notNull(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    rationale: text("rationale"),
    snapshot_date: text("snapshot_date").notNull(), // yyyy-mm-dd
  },
  (t) => [
    index("idx_recommendation_snapshot_date").on(t.snapshot_date),
    index("idx_recommendation_category").on(t.category),
    uniqueIndex("uq_recommendation_category_date").on(t.category, t.snapshot_date),
  ],
);

// ── My Stack (the models I have actually decided to use) ─────────────────────
// One row per category: my deliberate pick, kept separate from the algorithmic
// `recommendation`. The /stack page diffs the two to flag when a better model
// has appeared and my choice is due for review.

export const stackChoice = sqliteTable(
  "stack_choice",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Widened beyond the scored CATEGORY to include manual categories
    // (embedding/vision/image) that have no algorithmic recommendation.
    category: text("category", { enum: STACK_CATEGORY }).notNull(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    // Environment caveat where the real-world pick differs from the IU model id,
    // e.g. "Opus 4.8 in Claude Code (Max)" or "Charon voice".
    env_note: text("env_note"),
    rationale: text("rationale"),
    decided_at: text("decided_at").notNull(), // yyyy-mm-dd
  },
  (t) => [uniqueIndex("uq_stack_choice_category").on(t.category)],
);

// ── Audio demos (TTS/STT, curated by admin) ──────────────────────────────────

export const demo = sqliteTable(
  "demo",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modality: text("modality", { enum: MODALITY }).notNull(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    text_content: text("text_content").notNull(),
    lang: text("lang", { enum: LANG }).notNull().default("en"),
    preset: text("preset"),
    /** Gemini prebuilt voice name used for this demo (null for OpenAI-route models). */
    voice: text("voice"),
    audio_path: text("audio_path"),
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_demo_model_id").on(t.model_id), index("idx_demo_public").on(t.public)],
);

// ── News items (curated notable releases) ────────────────────────────────────

export const newsItem = sqliteTable(
  "news_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    summary: text("summary"),
    published_at: text("published_at"),
    model_id: text("model_id").references(() => models.id, {
      onDelete: "set null",
    }),
    reasonable: integer("reasonable", { mode: "boolean" }).notNull().default(true),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("uq_news_item_url").on(t.url),
    index("idx_news_item_published_at").on(t.published_at),
    index("idx_news_item_reasonable").on(t.reasonable),
  ],
);

// ── Inferred types ────────────────────────────────────────────────────────────

export type Model = typeof models.$inferSelect;
export type ModelInsert = typeof models.$inferInsert;
export type CapabilityProbe = typeof capabilityProbe.$inferSelect;
export type MetricSnapshot = typeof metricSnapshot.$inferSelect;
export type Recommendation = typeof recommendation.$inferSelect;
export type StackChoice = typeof stackChoice.$inferSelect;
export type StackChoiceInsert = typeof stackChoice.$inferInsert;
export type Demo = typeof demo.$inferSelect;
export type NewsItem = typeof newsItem.$inferSelect;

export type Modality = (typeof MODALITY)[number];
export type Residency = (typeof RESIDENCY)[number];
export type ProbeStatus = (typeof PROBE_STATUS)[number];
export type RecommendationCategory = (typeof CATEGORY)[number];
export type StackCategory = (typeof STACK_CATEGORY)[number];
export type Lang = (typeof LANG)[number];
export type MetricSource = (typeof METRIC_SOURCE)[number];
