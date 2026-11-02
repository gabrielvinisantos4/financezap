ALTER TABLE "subscriptions" ADD COLUMN "provider_checkout_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" text;--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_checkout_uq" ON "subscriptions" USING btree ("provider_checkout_id");