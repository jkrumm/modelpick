DO $$ BEGIN
 CREATE TYPE "modelpick"."probe_status" AS ENUM ('available', 'throttled', 'backend_error', 'not_routed', 'bad_request', 'timeout', 'unknown');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "modelpick"."capability_probe" ADD COLUMN IF NOT EXISTS "probe_status" "modelpick"."probe_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "modelpick"."capability_probe" ADD COLUMN IF NOT EXISTS "error" text;
