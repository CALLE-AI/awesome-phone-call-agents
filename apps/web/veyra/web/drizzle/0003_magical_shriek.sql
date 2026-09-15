ALTER TABLE "campaigns" ADD COLUMN "locale" text DEFAULT 'en-IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "approval_digest" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "failure_message" text;