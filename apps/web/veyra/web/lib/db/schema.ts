/**
 * Drizzle mirror of web/supabase/schema.sql — table structure only. RLS policies, the
 * profile trigger, and grants are NOT expressible as plain table structure and stay in
 * web/drizzle/<n>_rls_policies.sql, a hand-written migration Drizzle applies alongside
 * the generated ones. Change a table here, regenerate a migration
 * (`pnpm db:generate`), and if the change touches ownership columns, update the RLS
 * migration too — see web/supabase/schema.sql's own comments for the policy rationale.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// auth.users is owned by Supabase Auth (GoTrue), not by this app. Declared here only so
// foreign keys below can reference it — Drizzle never creates, alters, or drops it in
// practice, but `drizzle-kit generate` doesn't know that and WILL emit a
// `CREATE TABLE "auth"."users"` statement in every migration it generates from scratch.
// Delete that statement from the generated SQL before running `pnpm db:migrate` — see
// the note at the top of 0000_dapper_ghost_rider.sql for what the deleted statement
// looked like.
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  companyName: text("company_name"),
  // Private Supabase Storage object path, never a public or signed URL.
  avatarPath: text("avatar_path"),
  role: text("role").notNull().default("business_user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    sourcePrompt: text("source_prompt").notNull(),
    // The full Workflow object: nodes, edges, qualification, outcomeSchema.
    schema: jsonb("schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("workflows_user_id_idx").on(table.userId)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }),
    // The flattened Calls API request, once compiled.
    compiledRequest: jsonb("compiled_request"),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    locale: text("locale").notNull().default("en-IN"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalDigest: text("approval_digest"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
  },
  (table) => [
    index("campaigns_user_id_idx").on(table.userId),
    index("campaigns_workflow_id_idx").on(table.workflowId),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneNumber: text("phone_number").notNull(),
    metadata: jsonb("metadata"),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("contacts_campaign_id_idx").on(table.campaignId)],
);

export const callResults = pgTable(
  "call_results",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    calleCallId: text("calle_call_id"),
    idempotencyKey: text("idempotency_key"),
    approvalDigest: text("approval_digest"),
    // Immutable snapshot of the exact validated call draft used for this run.
    compiledRequest: jsonb("compiled_request"),
    qualified: boolean("qualified"),
    // Null is a valid, expected value: CALL-E returns structured_result: null when it
    // cannot extract a schema-valid result. See TECHNICAL_ARCH.md section 4.8.
    capturedData: jsonb("captured_data"),
    summary: text("summary"),
    transcript: text("transcript"),
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("call_results_campaign_id_idx").on(table.campaignId),
    index("call_results_contact_id_idx").on(table.contactId),
    uniqueIndex("call_results_calle_call_id_uidx").on(table.calleCallId),
    uniqueIndex("call_results_idempotency_key_uidx").on(table.idempotencyKey),
  ],
);

// CALL-E webhook delivery is at-least-once. Every event id is recorded before any side
// effect runs, and re-deliveries are skipped on the primary key conflict.
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
});
