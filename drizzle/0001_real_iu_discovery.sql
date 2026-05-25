ALTER TYPE "modelpick"."modality" ADD VALUE IF NOT EXISTS 'image';--> statement-breakpoint
ALTER TYPE "modelpick"."modality" ADD VALUE IF NOT EXISTS 'embedding';--> statement-breakpoint
ALTER TABLE "modelpick"."models" ADD COLUMN IF NOT EXISTS "iu_listed" boolean DEFAULT false NOT NULL;
