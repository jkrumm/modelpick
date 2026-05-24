CREATE SCHEMA "modelpick";
--> statement-breakpoint
CREATE TYPE "modelpick"."recommendation_category" AS ENUM('fast', 'coding', 'orchestrator', 'tts', 'stt');--> statement-breakpoint
CREATE TYPE "modelpick"."lang" AS ENUM('de', 'en');--> statement-breakpoint
CREATE TYPE "modelpick"."metric_source" AS ENUM('iu', 'openrouter', 'artificialanalysis');--> statement-breakpoint
CREATE TYPE "modelpick"."modality" AS ENUM('llm', 'tts', 'stt');--> statement-breakpoint
CREATE TYPE "modelpick"."residency" AS ENUM('eu', 'us', 'unknown');--> statement-breakpoint
CREATE TABLE "modelpick"."capability_probe" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"accessible" boolean NOT NULL,
	"latency_ms" real,
	"residency" "modelpick"."residency" DEFAULT 'unknown' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelpick"."demo" (
	"id" serial PRIMARY KEY NOT NULL,
	"modality" "modelpick"."modality" NOT NULL,
	"model_id" text NOT NULL,
	"text_content" text NOT NULL,
	"lang" "modelpick"."lang" DEFAULT 'en' NOT NULL,
	"preset" text,
	"audio_path" text,
	"public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelpick"."metric_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"source" "modelpick"."metric_source" NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"confidence" real,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelpick"."models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"family" text,
	"modality" "modelpick"."modality" NOT NULL,
	"display_name" text NOT NULL,
	"context_window" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelpick"."news_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"summary" text,
	"published_at" timestamp with time zone,
	"model_id" text,
	"reasonable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelpick"."recommendation" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "modelpick"."recommendation_category" NOT NULL,
	"model_id" text NOT NULL,
	"score" real NOT NULL,
	"rationale" text,
	"snapshot_date" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modelpick"."capability_probe" ADD CONSTRAINT "capability_probe_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "modelpick"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelpick"."demo" ADD CONSTRAINT "demo_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "modelpick"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelpick"."metric_snapshot" ADD CONSTRAINT "metric_snapshot_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "modelpick"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelpick"."news_item" ADD CONSTRAINT "news_item_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "modelpick"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelpick"."recommendation" ADD CONSTRAINT "recommendation_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "modelpick"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_capability_probe_model_id" ON "modelpick"."capability_probe" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "idx_capability_probe_checked_at" ON "modelpick"."capability_probe" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "idx_demo_model_id" ON "modelpick"."demo" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "idx_demo_public" ON "modelpick"."demo" USING btree ("public");--> statement-breakpoint
CREATE INDEX "idx_metric_snapshot_model_id" ON "modelpick"."metric_snapshot" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "idx_metric_snapshot_captured_at" ON "modelpick"."metric_snapshot" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "idx_metric_snapshot_source_metric" ON "modelpick"."metric_snapshot" USING btree ("source","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_news_item_url" ON "modelpick"."news_item" USING btree ("url");--> statement-breakpoint
CREATE INDEX "idx_news_item_published_at" ON "modelpick"."news_item" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_news_item_reasonable" ON "modelpick"."news_item" USING btree ("reasonable");--> statement-breakpoint
CREATE INDEX "idx_recommendation_snapshot_date" ON "modelpick"."recommendation" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_recommendation_category" ON "modelpick"."recommendation" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recommendation_category_date" ON "modelpick"."recommendation" USING btree ("category","snapshot_date");