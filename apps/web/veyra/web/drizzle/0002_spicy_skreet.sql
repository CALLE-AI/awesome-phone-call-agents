ALTER TABLE "call_results" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "approval_digest" text;--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "compiled_request" jsonb;--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "call_results" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "call_results_calle_call_id_uidx" ON "call_results" USING btree ("calle_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_results_idempotency_key_uidx" ON "call_results" USING btree ("idempotency_key");