ALTER TABLE "users" ADD COLUMN "recovery_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_count" integer DEFAULT 0 NOT NULL;