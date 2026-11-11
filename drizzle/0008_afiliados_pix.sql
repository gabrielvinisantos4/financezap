CREATE TYPE "public"."payout_method" AS ENUM('asaas_split', 'pix');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('awaiting_approval', 'processing', 'paid', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "affiliate_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"pix_key" text NOT NULL,
	"pix_key_type" text NOT NULL,
	"status" "payout_status" DEFAULT 'awaiting_approval' NOT NULL,
	"provider_transfer_id" text,
	"fail_reason" text,
	"approved_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "payout_method" "payout_method" DEFAULT 'asaas_split' NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "pix_key" text;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "pix_key_type" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_payouts_affiliate_idx" ON "affiliate_payouts" USING btree ("affiliate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_payouts_transfer_uq" ON "affiliate_payouts" USING btree ("provider_transfer_id");