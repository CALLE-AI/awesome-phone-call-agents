CREATE TYPE "public"."workspace_kind" AS ENUM('demo', 'protected');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'operator', 'auditor');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"kind" "workspace_kind" DEFAULT 'demo' NOT NULL,
	"provider" "provider_name" DEFAULT 'fake' NOT NULL,
	"live_calls_allowed" boolean DEFAULT false NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_demo_fake_only_ck" CHECK ("workspace"."kind" <> 'demo' or ("workspace"."provider" = 'fake' and "workspace"."live_calls_allowed" = false))
);
--> statement-breakpoint
ALTER TABLE "closeout_case" DROP CONSTRAINT "closeout_case_contact_id_contact_id_fk";
--> statement-breakpoint
DROP INDEX "closeout_case_work_order_ref_uq";--> statement-breakpoint
ALTER TABLE "closeout_case" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_membership_workspace_user_uq" ON "workspace_membership" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_membership_user_idx" ON "workspace_membership" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_uq" ON "workspace" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspace_owner_kind_idx" ON "workspace" USING btree ("owner_user_id","kind");--> statement-breakpoint
INSERT INTO "user" ("id", "name", "email", "email_verified", "updated_at")
SELECT
	'fieldclose-legacy-migration-owner',
	'Legacy migration owner',
	'legacy-migration-owner@fieldclose.invalid',
	false,
	now()
WHERE EXISTS (SELECT 1 FROM "contact")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace" (
	"id",
	"slug",
	"display_name",
	"kind",
	"provider",
	"live_calls_allowed",
	"owner_user_id"
)
SELECT
	'00000000-0000-4000-8000-000000000001',
	'legacy-migration',
	'Legacy migration workspace',
	'demo',
	'fake',
	false,
	'fieldclose-legacy-migration-owner'
WHERE EXISTS (SELECT 1 FROM "contact")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_membership" (
	"id",
	"workspace_id",
	"user_id",
	"role"
)
SELECT
	'00000000-0000-4000-8000-000000000002',
	'00000000-0000-4000-8000-000000000001',
	'fieldclose-legacy-migration-owner',
	'owner'
WHERE EXISTS (
	SELECT 1
	FROM "workspace"
	WHERE "id" = '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "contact"
SET "workspace_id" = '00000000-0000-4000-8000-000000000001'
WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "closeout_case" AS "closeout"
SET "workspace_id" = "contact"."workspace_id"
FROM "contact"
WHERE
	"closeout"."contact_id" = "contact"."id"
	AND "closeout"."workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "closeout_case" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_id_workspace_uq" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "closeout_case" ADD CONSTRAINT "closeout_case_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_case" ADD CONSTRAINT "closeout_case_contact_workspace_fk" FOREIGN KEY ("contact_id","workspace_id") REFERENCES "public"."contact"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "closeout_case_workspace_work_order_ref_uq" ON "closeout_case" USING btree ("workspace_id","work_order_ref");
