CREATE TYPE "public"."attempt_outcome" AS ENUM('not_determined', 'answered', 'partial_answer', 'no_answer', 'busy', 'voicemail', 'wrong_person', 'refused', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('operator', 'system', 'provider');--> statement-breakpoint
CREATE TYPE "public"."authorization_basis" AS ENUM('existing_service_contact', 'contact_requested_follow_up', 'contractor_provided_authorized_contact', 'demo_fixture');--> statement-breakpoint
CREATE TYPE "public"."call_mode" AS ENUM('dry_run', 'fake', 'live');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('draft', 'approved', 'calling', 'completed', 'needs_attention', 'failed', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contact_verification" AS ENUM('intended_contact', 'authorized_role', 'wrong_person', 'unverified', 'refused', 'not_connected');--> statement-breakpoint
CREATE TYPE "public"."creation_disposition" AS ENUM('not_requested', 'created', 'duplicate_returned', 'blocked', 'failed_before_acceptance', 'ambiguous_requires_reconciliation');--> statement-breakpoint
CREATE TYPE "public"."follow_up_task_status" AS ENUM('open', 'in_progress', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."follow_up_task_type" AS ENUM('closeout_review', 'return_visit_review', 'contact_review', 'technical_review', 'provider_reconciliation', 'privacy_request');--> statement-breakpoint
CREATE TYPE "public"."observed_operating_status" AS ENUM('operating_as_expected', 'not_operating_as_expected', 'mixed_or_partial', 'unknown', 'not_asked', 'refused');--> statement-breakpoint
CREATE TYPE "public"."provider_name" AS ENUM('fake', 'call_e');--> statement-breakpoint
CREATE TYPE "public"."provider_task_status" AS ENUM('not_created', 'queued', 'in_progress', 'completed', 'failed', 'canceled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."result_route" AS ENUM('ready_for_closeout_review', 'return_visit_review', 'human_follow_up', 'unreachable', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_processing_status" AS ENUM('received', 'processed', 'quarantined');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"attempt_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" varchar(128),
	"event_type" varchar(120) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version" integer NOT NULL,
	"approved_attempt_id" uuid NOT NULL,
	"approved_by" varchar(128) NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"brief_hash" varchar(64) NOT NULL,
	"live_call_approved" boolean DEFAULT false NOT NULL,
	"calling_window" jsonb NOT NULL,
	"operator_attestations" jsonb NOT NULL,
	CONSTRAINT "call_approval_identity_scope_uq" UNIQUE("id","case_id","approved_attempt_id"),
	CONSTRAINT "call_approval_case_version_positive_ck" CHECK ("call_approval"."case_version" > 0),
	CONSTRAINT "call_approval_attestations_nonempty_ck" CHECK (jsonb_typeof("call_approval"."operator_attestations") = 'array' and jsonb_array_length("call_approval"."operator_attestations") > 0)
);
--> statement-breakpoint
CREATE TABLE "call_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"approval_id" uuid,
	"mode" "call_mode" NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"provider" "provider_name" NOT NULL,
	"provider_call_id" varchar(200),
	"provider_task_status" "provider_task_status" DEFAULT 'not_created' NOT NULL,
	"attempt_outcome" "attempt_outcome" DEFAULT 'not_determined' NOT NULL,
	"creation_disposition" "creation_disposition" DEFAULT 'not_requested' NOT NULL,
	"requested_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_attempt_id_case_uq" UNIQUE("id","case_id"),
	CONSTRAINT "call_attempt_live_requires_approval_ck" CHECK ("call_attempt"."mode" <> 'live' or "call_attempt"."approval_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "call_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"provider_call_id" varchar(200),
	"provider_task_status" "provider_task_status" NOT NULL,
	"contact_verification" "contact_verification" NOT NULL,
	"observed_operating_status" "observed_operating_status" NOT NULL,
	"unresolved_issue" jsonb NOT NULL,
	"return_visit_requested" jsonb NOT NULL,
	"preferred_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"administrative_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"out_of_scope_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" varchar(1000) NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"route" "result_route" NOT NULL,
	"normalizer_version" varchar(40) NOT NULL,
	"normalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closeout_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"work_order_ref" varchar(80) NOT NULL,
	"contractor_display_name" varchar(120) NOT NULL,
	"site_label" varchar(160) NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"contact_id" uuid NOT NULL,
	"requested_fields" jsonb NOT NULL,
	"visit_context" jsonb NOT NULL,
	"current_attempt_id" uuid,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "closeout_case_version_positive_ck" CHECK ("closeout_case"."version" > 0),
	CONSTRAINT "closeout_case_requested_fields_nonempty_ck" CHECK (jsonb_typeof("closeout_case"."requested_fields") = 'array' and jsonb_array_length("closeout_case"."requested_fields") > 0)
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(120),
	"role" varchar(64) NOT NULL,
	"phone_e164_ciphertext" text NOT NULL,
	"phone_encryption_iv" varchar(32) NOT NULL,
	"phone_encryption_tag" varchar(32) NOT NULL,
	"phone_key_version" varchar(32) NOT NULL,
	"phone_lookup_hash" varchar(64) NOT NULL,
	"phone_masked" varchar(32) NOT NULL,
	"authorization_basis" "authorization_basis" NOT NULL,
	"authorization_note" varchar(500) NOT NULL,
	"do_not_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_phone_masked_not_blank_ck" CHECK (length(trim("contact"."phone_masked")) > 0)
);
--> statement-breakpoint
CREATE TABLE "follow_up_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" "follow_up_task_type" NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"status" "follow_up_task_status" DEFAULT 'open' NOT NULL,
	"assigned_to" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" varchar(1000),
	CONSTRAINT "follow_up_task_reason_codes_nonempty_ck" CHECK (jsonb_typeof("follow_up_task"."reason_codes") = 'array' and jsonb_array_length("follow_up_task"."reason_codes") > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" varchar(200) NOT NULL,
	"provider_call_id" varchar(200),
	"attempt_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"processing_status" "webhook_processing_status" DEFAULT 'received' NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_code" varchar(80),
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_setting" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"boolean_value" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(128) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_attempt_case_fk" FOREIGN KEY ("attempt_id","case_id") REFERENCES "public"."call_attempt"("id","case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_approval" ADD CONSTRAINT "call_approval_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_approval" ADD CONSTRAINT "call_approval_attempt_case_fk" FOREIGN KEY ("approved_attempt_id","case_id") REFERENCES "public"."call_attempt"("id","case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_attempt" ADD CONSTRAINT "call_attempt_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_attempt" ADD CONSTRAINT "call_attempt_approval_id_call_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."call_approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_result" ADD CONSTRAINT "call_result_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_result" ADD CONSTRAINT "call_result_attempt_case_fk" FOREIGN KEY ("attempt_id","case_id") REFERENCES "public"."call_attempt"("id","case_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_case" ADD CONSTRAINT "closeout_case_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_case" ADD CONSTRAINT "closeout_case_current_attempt_id_call_attempt_id_fk" FOREIGN KEY ("current_attempt_id") REFERENCES "public"."call_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_task" ADD CONSTRAINT "follow_up_task_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhook_event" ADD CONSTRAINT "provider_webhook_event_attempt_id_call_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."call_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_case_occurred_idx" ON "audit_event" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_attempt_occurred_idx" ON "audit_event" USING btree ("attempt_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_approval_attempt_uq" ON "call_approval" USING btree ("approved_attempt_id");--> statement-breakpoint
CREATE INDEX "call_approval_case_approved_idx" ON "call_approval" USING btree ("case_id","approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempt_idempotency_key_uq" ON "call_attempt" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempt_provider_call_id_uq" ON "call_attempt" USING btree ("provider_call_id") WHERE "call_attempt"."provider_call_id" is not null;--> statement-breakpoint
CREATE INDEX "call_attempt_case_created_idx" ON "call_attempt" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "call_attempt_reconciliation_idx" ON "call_attempt" USING btree ("creation_disposition","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_result_attempt_uq" ON "call_result" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "call_result_case_normalized_idx" ON "call_result" USING btree ("case_id","normalized_at");--> statement-breakpoint
CREATE UNIQUE INDEX "closeout_case_work_order_ref_uq" ON "closeout_case" USING btree ("work_order_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "closeout_case_current_attempt_uq" ON "closeout_case" USING btree ("current_attempt_id") WHERE "closeout_case"."current_attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "closeout_case_status_updated_idx" ON "closeout_case" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "contact_phone_lookup_hash_idx" ON "contact" USING btree ("phone_lookup_hash");--> statement-breakpoint
CREATE INDEX "follow_up_task_queue_idx" ON "follow_up_task" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_event_provider_id_uq" ON "provider_webhook_event" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_webhook_event_call_received_idx" ON "provider_webhook_event" USING btree ("provider_call_id","received_at");--> statement-breakpoint
ALTER TABLE "call_attempt" ADD CONSTRAINT "call_attempt_approval_scope_fk" FOREIGN KEY ("approval_id","case_id","id") REFERENCES "public"."call_approval"("id","case_id","approved_attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_case" ADD CONSTRAINT "closeout_case_current_attempt_scope_fk" FOREIGN KEY ("current_attempt_id","id") REFERENCES "public"."call_attempt"("id","case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "system_setting" ("key", "boolean_value", "updated_by")
VALUES ('live_calls_paused', true, 'migration');--> statement-breakpoint
CREATE FUNCTION "reject_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
	IF current_setting('fieldclose.allow_audit_mutation', true) IS DISTINCT FROM 'on' THEN
		RAISE EXCEPTION 'audit_event is append-only'
			USING ERRCODE = '42501';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only"
BEFORE UPDATE OR DELETE ON "audit_event"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();
