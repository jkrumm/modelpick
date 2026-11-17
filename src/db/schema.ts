import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// SQLite has no native enum type — Drizzle emits a CHECK constraint from the
// `enum` option and surfaces the union on the inferred type. The value tuples
// are exported so tests and callers can assert against them.
// `decision` = typed-answer classifiers (Clef, Jev, PPLX Decider, Luna's Decisions
// route): they answer yes/no, choice and score questions with probabilities and
// cannot generate text, so a plain chat probe or a chat-leaderboard score is
// meaningless for them (docs/decisions/decision-model.md).
export const MODALITY = ["llm", "tts", "stt", "image", "embedding", "decision"] as const;
export const RESIDENCY = ["eu", "us", "unknown"] as const;
// How much reasoning a measurement was taken under. `default` = the model's own
// adaptive behaviour (nothing pinned); `off` = explicitly suppressed; `n/a` =
// the model has no reasoning control. Recorded because a latency measured with
// thinking off is NOT comparable to one measured at default effort — reading
// the two off one column is what made `gpt-5.6-luna` look categorically faster
// than it is (docs/decisions/hermes-brain.md, 2026-09-11).
export const THINKING = [
  "default",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "n/a",
] as const;
// Gateway route a model is served through. 'iu' = the IU-native per-provider
// routes (OpenAI/Anthropic/Gemini dialects, see client.ts); 'replicate' = the
// IU gateway's Replicate proxy (see replicate.ts).
export const TRANSPORT = ["iu", "replicate"] as const;
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
export const LANG = ["de", "en"] as const;
// Reasoning effort of an AA variant. A bare slug takes the effort AA names in its name
// parenthetical, else `max` (lineage has other effort rows) or `default` (none).
export const AA_EFFORT = ["none", "low", "medium", "high", "xhigh", "max", "default"] as const;
// 'live' = measured directly against the IU endpoint (scripts/benchmark-throughput.ts),
// as opposed to the external leaderboard collectors.
export const METRIC_SOURCE = [
  "iu",
  "openrouter",
  "artificialanalysis",
  "live",
  "epoch",
  "modelsdev",
  "lmarena",
] as const;

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
  transport: text("transport", { enum: TRANSPORT }).notNull().default("iu"),
  // Backend route list the IU gateway reports (`Requesty-EU`, `… GDPR`, …): the best
  // residency hint there is. Null for ids only a non-OpenAI leg lists.
  owned_by: text("owned_by"),
  // Comma-separated IU legs that accept this id (openai, anthropic, gemini, decisions).
  legs: text("legs"),
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
// metric values: 'quality' | 'coding_index' | 'price_in' | 'price_out' | 'context_window'
//   | 'throughput' | 'latency_p50' (leaderboard, seconds)
//   | 'ttft_ms' (live, milliseconds — measured against IU by benchmark-throughput.ts)
//   | 'tool_call_coverage' | 'tool_call_success' | 'tool_call_rounds' (live)

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
    // The reasoning configuration the measurement was taken under, for the
    // `live` source (null for leaderboard rows, which never disclose it).
    // A `ttft_ms` recorded at `off` and one recorded at `default` differ by an
    // order of magnitude on the same model, so they must never be averaged or
    // ranked against each other unlabelled.
    conditions: text("conditions", { enum: THINKING }),
    captured_at: text("captured_at").notNull().default(now),
  },
  (t) => [
    index("idx_metric_snapshot_model_id").on(t.model_id),
    index("idx_metric_snapshot_captured_at").on(t.captured_at),
    index("idx_metric_snapshot_source_metric").on(t.source, t.metric),
  ],
);

// ── ArtificialAnalysis variants (one row per AA slug, effort variants separate) ──
// Upserted daily from the free Data API fetch the metrics collector already makes. AA
// publishes each reasoning-effort variant under its own slug (`gpt-6-1-terra-medium`);
// `lineage` is the slug minus that suffix, `effort` the parsed level. A slug that vanishes
// from the API keeps its row — `updated_at` tells how stale it is. Attribution is required
// wherever this data is shown (AGENTS.md, "ArtificialAnalysis terms").
export const aaVariant = sqliteTable(
  "aa_variant",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    lineage: text("lineage").notNull(),
    effort: text("effort", { enum: AA_EFFORT }).notNull(),
    creator: text("creator").notNull(),
    release_date: text("release_date"),
    intelligence: real("intelligence"),
    cost_per_task: real("cost_per_task"),
    price_in: real("price_in"),
    price_out: real("price_out"),
    price_cache_read: real("price_cache_read"),
    price_cache_write: real("price_cache_write"),
    tps: real("tps"),
    ttft_sec: real("ttft_sec"),
    ttfat_sec: real("ttfat_sec"),
    e2e_sec: real("e2e_sec"),
    first_seen_at: text("first_seen_at").notNull().default(now),
    updated_at: text("updated_at").notNull().default(now),
  },
  (t) => [index("idx_aa_variant_lineage").on(t.lineage)],
);

// ── Release alerts (one ntfy push per lineage, ever) ─────────────────────────
// `lineage` is an AA lineage (kind `aa`) or an IU catalog id (kind `iu`). `seed` / `iu_seed` rows
// are the silent AA / IU baselines; a candidate judged not big is not recorded at all.
export const releaseAlert = sqliteTable("release_alert", {
  lineage: text("lineage").primaryKey(),
  kind: text("kind", { enum: ["aa", "iu", "seed", "iu_seed"] }).notNull(),
  notified_at: text("notified_at").notNull().default(now),
});

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

// ── Inferred types ────────────────────────────────────────────────────────────

export type Model = typeof models.$inferSelect;
export type ModelInsert = typeof models.$inferInsert;
export type CapabilityProbe = typeof capabilityProbe.$inferSelect;
export type MetricSnapshot = typeof metricSnapshot.$inferSelect;
export type AaVariant = typeof aaVariant.$inferSelect;
export type AaVariantInsert = typeof aaVariant.$inferInsert;
export type Demo = typeof demo.$inferSelect;

export type Modality = (typeof MODALITY)[number];
export type Residency = (typeof RESIDENCY)[number];
export type ProbeStatus = (typeof PROBE_STATUS)[number];
export type Thinking = (typeof THINKING)[number];
export type Lang = (typeof LANG)[number];
export type MetricSource = (typeof METRIC_SOURCE)[number];
export type Transport = (typeof TRANSPORT)[number];
