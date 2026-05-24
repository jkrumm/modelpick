import {
  boolean,
  index,
  integer,
  pgSchema,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const mp = pgSchema("modelpick");

export const modalityEnum = mp.enum("modality", ["llm", "tts", "stt"]);
export const residencyEnum = mp.enum("residency", ["eu", "us", "unknown"]);
export const categoryEnum = mp.enum("recommendation_category", [
  "fast",
  "coding",
  "orchestrator",
  "tts",
  "stt",
]);
export const langEnum = mp.enum("lang", ["de", "en"]);
export const metricSourceEnum = mp.enum("metric_source", [
  "iu",
  "openrouter",
  "artificialanalysis",
]);

// ── Models (catalog) ────────────────────────────────────────────────────────
// id is the API-facing model identifier, e.g. 'claude-sonnet-4-6', 'tts-hd'

export const models = mp.table("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  family: text("family"),
  modality: modalityEnum("modality").notNull(),
  display_name: text("display_name").notNull(),
  context_window: integer("context_window"),
  created_at: timestamp("created_at", {
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
});

// ── Capability probes (IU endpoint access checks) ────────────────────────────

export const capabilityProbe = mp.table(
  "capability_probe",
  {
    id: serial("id").primaryKey(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    accessible: boolean("accessible").notNull(),
    latency_ms: real("latency_ms"),
    residency: residencyEnum("residency").notNull().default("unknown"),
    checked_at: timestamp("checked_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_capability_probe_model_id").on(t.model_id),
    index("idx_capability_probe_checked_at").on(t.checked_at),
  ],
);

// ── Metric snapshots (quality/price/throughput per source) ───────────────────
// metric values: 'quality' | 'price_in' | 'price_out' | 'throughput' | 'latency_p50'

export const metricSnapshot = mp.table(
  "metric_snapshot",
  {
    id: serial("id").primaryKey(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    source: metricSourceEnum("source").notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    confidence: real("confidence"),
    captured_at: timestamp("captured_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_metric_snapshot_model_id").on(t.model_id),
    index("idx_metric_snapshot_captured_at").on(t.captured_at),
    index("idx_metric_snapshot_source_metric").on(t.source, t.metric),
  ],
);

// ── Recommendations (one per category per snapshot date) ─────────────────────

export const recommendation = mp.table(
  "recommendation",
  {
    id: serial("id").primaryKey(),
    category: categoryEnum("category").notNull(),
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
    uniqueIndex("uq_recommendation_category_date").on(
      t.category,
      t.snapshot_date,
    ),
  ],
);

// ── Audio demos (TTS/STT, curated by admin) ──────────────────────────────────

export const demo = mp.table(
  "demo",
  {
    id: serial("id").primaryKey(),
    modality: modalityEnum("modality").notNull(),
    model_id: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    text_content: text("text_content").notNull(),
    lang: langEnum("lang").notNull().default("en"),
    preset: text("preset"),
    audio_path: text("audio_path"),
    public: boolean("public").notNull().default(false),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_demo_model_id").on(t.model_id),
    index("idx_demo_public").on(t.public),
  ],
);

// ── News items (curated notable releases) ────────────────────────────────────

export const newsItem = mp.table(
  "news_item",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    summary: text("summary"),
    published_at: timestamp("published_at", {
      withTimezone: true,
      mode: "string",
    }),
    model_id: text("model_id").references(() => models.id, {
      onDelete: "set null",
    }),
    reasonable: boolean("reasonable").notNull().default(true),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
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
export type Demo = typeof demo.$inferSelect;
export type NewsItem = typeof newsItem.$inferSelect;

export type Modality = (typeof modalityEnum.enumValues)[number];
export type Residency = (typeof residencyEnum.enumValues)[number];
export type RecommendationCategory = (typeof categoryEnum.enumValues)[number];
export type Lang = (typeof langEnum.enumValues)[number];
export type MetricSource = (typeof metricSourceEnum.enumValues)[number];
