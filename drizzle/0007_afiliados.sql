CREATE TYPE "public"."affiliate_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('credited', 'reversed');--> statement-breakpoint
CREATE TABLE "affiliate_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"provider_payment_id" text NOT NULL,
	"net_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"status" "commission_status" DEFAULT 'credited' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"wallet_id" text,
	"commission_bps" integer NOT NULL,
	"status" "affiliate_status" DEFAULT 'active' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "affiliate_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_affiliate_id" uuid;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_commissions_payment_uq" ON "affiliate_commissions" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "affiliate_commissions_affiliate_idx" ON "affiliate_commissions" USING btree ("affiliate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_user_uq" ON "affiliates" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_code_uq" ON "affiliates" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_affiliate_id");