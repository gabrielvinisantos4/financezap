CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'cash', 'wallet', 'investment', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."data_request_status" AS ENUM('requested', 'processing', 'done', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."data_request_type" AS ENUM('export', 'delete');--> statement-breakpoint
CREATE TYPE "public"."history_action" AS ENUM('create', 'update', 'delete', 'restore');--> statement-breakpoint
CREATE TYPE "public"."inbound_status" AS ENUM('queued', 'processing', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pending_action_status" AS ENUM('pending', 'done', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('income', 'expense', 'transfer', 'card_payment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."tx_source" AS ENUM('whatsapp', 'web', 'system');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('paid', 'pending');--> statement-breakpoint
CREATE TYPE "public"."usage_type" AS ENUM('ai_call', 'wa_inbound', 'wa_outbound');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'support', 'admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'deleted');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"initial_balance_cents" integer DEFAULT 0 NOT NULL,
	"credit_limit_cents" integer,
	"closing_day" integer,
	"due_day" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "accounts_days_ck" CHECK ((closing_day is null or closing_day between 1 and 31) and (due_day is null or due_day between 1 and 31))
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text DEFAULT '•' NOT NULL,
	"parent_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_user_uq" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"ip" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "data_request_type" NOT NULL,
	"status" "data_request_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_message_id" text NOT NULL,
	"wa_id" text NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb,
	"status" "inbound_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"user_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"wa_id" text NOT NULL,
	"wa_message_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider_payment_id" text NOT NULL,
	"status" text NOT NULL,
	"value_cents" integer NOT NULL,
	"billing_type" text,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "pending_action_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly_cents" integer NOT NULL,
	"price_yearly_cents" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "tx_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"day_of_month" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"end_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "recurring_amount_ck" CHECK (amount_cents > 0),
	CONSTRAINT "recurring_day_ck" CHECK (day_of_month between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"cycle" "billing_cycle" NOT NULL,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"price_cents" integer NOT NULL,
	"provider" text DEFAULT 'asaas' NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" "history_action" NOT NULL,
	"actor" "actor_type" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "tx_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"counterparty" text,
	"category_id" uuid,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"occurred_on" date NOT NULL,
	"due_on" date,
	"status" "tx_status" DEFAULT 'paid' NOT NULL,
	"payment_method" text,
	"installment_group_id" uuid,
	"installment_number" integer,
	"installment_total" integer,
	"recurring_rule_id" uuid,
	"refund_of_id" uuid,
	"notes" text,
	"source" "tx_source" DEFAULT 'web' NOT NULL,
	"source_message_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "tx_amount_positive_ck" CHECK (amount_cents > 0),
	CONSTRAINT "tx_transfer_target_ck" CHECK ((kind in ('transfer','card_payment')) = (to_account_id is not null)),
	CONSTRAINT "tx_transfer_distinct_ck" CHECK (to_account_id is null or to_account_id <> account_id),
	CONSTRAINT "tx_installment_ck" CHECK ((installment_total is null and installment_number is null) or (installment_number between 1 and installment_total))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" "usage_type" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"can_view_pii" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wa_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_history" ADD CONSTRAINT "transaction_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_to_account_fk" FOREIGN KEY ("to_account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_refund_of_fk" FOREIGN KEY ("refund_of_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_recurring_fk" FOREIGN KEY ("recurring_rule_id","user_id") REFERENCES "public"."recurring_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_identities" ADD CONSTRAINT "whatsapp_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_uq" ON "accounts" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_uq" ON "billing_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_kind_slug_uq" ON "categories" USING btree ("user_id","kind","slug");--> statement-breakpoint
CREATE INDEX "turns_user_created_idx" ON "conversation_turns" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_wa_msg_uq" ON "inbound_messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "inbound_status_idx" ON "inbound_messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "link_codes_hash_uq" ON "link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "op_events_created_idx" ON "operational_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "op_events_level_idx" ON "operational_events" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "outbound_wa_msg_idx" ON "outbound_messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_uq" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "pending_user_status_idx" ON "pending_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_slug_uq" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_uq" ON "subscriptions" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tx_history_tx_idx" ON "transaction_history" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "tx_user_date_idx" ON "transactions" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "tx_user_kind_date_idx" ON "transactions" USING btree ("user_id","kind","occurred_on");--> statement-breakpoint
CREATE INDEX "tx_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "tx_user_status_due_idx" ON "transactions" USING btree ("user_id","status","due_on");--> statement-breakpoint
CREATE INDEX "tx_installment_group_idx" ON "transactions" USING btree ("installment_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_source_message_uq" ON "transactions" USING btree ("user_id","source_message_id",coalesce(installment_number, 0)) WHERE source_message_id is not null;--> statement-breakpoint
CREATE INDEX "usage_user_created_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_type_created_idx" ON "usage_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "wa_identities_wa_uq" ON "whatsapp_identities" USING btree ("wa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_identities_user_uq" ON "whatsapp_identities" USING btree ("user_id");