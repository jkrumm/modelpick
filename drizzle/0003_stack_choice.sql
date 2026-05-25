CREATE TABLE IF NOT EXISTS "modelpick"."stack_choice" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "modelpick"."recommendation_category" NOT NULL,
	"model_id" text NOT NULL REFERENCES "modelpick"."models"("id") ON DELETE cascade,
	"env_note" text,
	"rationale" text,
	"decided_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stack_choice_category" ON "modelpick"."stack_choice" USING btree ("category");
