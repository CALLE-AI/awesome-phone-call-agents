import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const followUpRecords = mysqlTable(
  "follow_up_records",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    dedupeKey: varchar("dedupeKey", { length: 128 }).notNull(),
    womanId: varchar("womanId", { length: 128 }).notNull(),
    contactMethod: mysqlEnum("contactMethod", ["visit", "phone", "sms"]).notNull(),
    outcome: mysqlEnum("outcome", ["reached", "no_answer", "needs_clinician"]).notNull(),
    note: text("note").notNull(),
    nextAction: mysqlEnum("nextAction", ["call_again", "clinic_visit", "urgent_review", "none"]).notNull(),
    status: mysqlEnum("status", ["completed"]).notNull(),
    clientUpdatedAt: timestamp("clientUpdatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userDedupeIdx: uniqueIndex("follow_up_records_user_dedupe_idx").on(table.userId, table.dedupeKey),
  }),
);

export type FollowUpRecord = typeof followUpRecords.$inferSelect;
export type InsertFollowUpRecord = typeof followUpRecords.$inferInsert;

/**
 * Privacy-minimized CALL-E phone workflow metadata.
 * Transcripts are intentionally not stored. Phone numbers are stored server-side only.
 */
export const callWorkflows = mysqlTable(
  "call_workflows",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId").notNull(),
    womanId: varchar("womanId", { length: 128 }).notNull(),
    purpose: mysqlEnum("purpose", [
      "follow_up_after_check_in",
      "appointment_coordination",
      "callback_confirmation",
    ]).notNull(),
    recipientE164: varchar("recipientE164", { length: 32 }).notNull(),
    recipientRegion: varchar("recipientRegion", { length: 8 }).notNull(),
    callLanguage: varchar("callLanguage", { length: 16 }).notNull(),
    triageState: mysqlEnum("triageState", ["routine", "contact_chw_today", "urgent_in_person_care"]).notNull(),
    callConsentGranted: int("callConsentGranted").notNull().default(0),
    policyDecision: mysqlEnum("policyDecision", ["allow", "dry_run", "deny"]).notNull(),
    policyReasonCode: varchar("policyReasonCode", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 64 }).notNull(),
    prepareToken: varchar("prepareToken", { length: 64 }).notNull(),
    providerCallId: varchar("providerCallId", { length: 128 }),
    status: mysqlEnum("status", [
      "prepared",
      "starting",
      "in_progress",
      "completed",
      "no_answer",
      "failed",
      "cancelled",
      "dry_run_completed",
      "unknown",
    ]).notNull(),
    dryRun: int("dryRun").notNull().default(1),
    structuredResultJson: text("structuredResultJson"),
    failureCode: varchar("failureCode", { length: 64 }),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdempotencyIdx: uniqueIndex("call_workflows_user_idempotency_idx").on(table.userId, table.idempotencyKey),
  }),
);

export type CallWorkflowRecord = typeof callWorkflows.$inferSelect;
export type InsertCallWorkflowRecord = typeof callWorkflows.$inferInsert;

/** V6 billing — catalog is server config; these tables hold mutable customer state. */
export const billingSubscriptions = mysqlTable(
  "billing_subscriptions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId").notNull(),
    orgId: varchar("orgId", { length: 64 }),
    planId: varchar("planId", { length: 64 }).notNull(),
    state: mysqlEnum("state", [
      "trialing",
      "active",
      "grace_period",
      "paused",
      "past_due",
      "canceled",
      "expired",
      "refunded",
      "revoked",
      "pending_verification",
      "organization_suspended",
    ]).notNull(),
    provider: mysqlEnum("provider", ["mock", "apple", "google_play", "stripe", "invoice"]).notNull(),
    providerTransactionId: varchar("providerTransactionId", { length: 256 }),
    trialEndsAt: timestamp("trialEndsAt"),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    canceledAt: timestamp("canceledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex("billing_subscriptions_user_idx").on(table.userId),
  }),
);

export const billingUsageMeters = mysqlTable(
  "billing_usage_meters",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    meter: varchar("meter", { length: 64 }).notNull(),
    attempted: int("attempted").notNull().default(0),
    successful: int("successful").notNull().default(0),
    failed: int("failed").notNull().default(0),
    billable: int("billable").notNull().default(0),
    periodKey: varchar("periodKey", { length: 16 }).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userMeterPeriodIdx: uniqueIndex("billing_usage_user_meter_period_idx").on(
      table.userId,
      table.meter,
      table.periodKey,
    ),
  }),
);

export const billingCallCredits = mysqlTable("billing_call_credits", {
  userId: int("userId").primaryKey(),
  balance: int("balance").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * CALL-E API-integration layer (hackathon V4 pack).
 * Separate from `call_workflows` so the existing CHW workflow store is unchanged.
 * Phone numbers live only inside payloadJson on the server.
 */
export const calleApiCalls = mysqlTable(
  "calle_api_calls",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    providerCallId: varchar("providerCallId", { length: 128 }).notNull(),
    userId: varchar("userId", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    task: text("task").notNull(),
    structuredResultJson: text("structuredResultJson"),
    summary: text("summary"),
    taskCompleted: int("taskCompleted"),
    completionConfidence: int("completionConfidence"),
    metadataJson: text("metadataJson").notNull(),
    payloadJson: text("payloadJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdx: index("calle_api_calls_user_idx").on(table.userId),
    statusIdx: index("calle_api_calls_status_idx").on(table.status),
    providerIdx: uniqueIndex("calle_api_calls_provider_idx").on(table.providerCallId),
  }),
);

export const calleApiEvents = mysqlTable(
  "calle_api_events",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    providerCallId: varchar("providerCallId", { length: 128 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    payloadJson: text("payloadJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    callIdx: index("calle_api_events_call_idx").on(table.providerCallId),
  }),
);

export const calleApiIdempotency = mysqlTable("calle_api_idempotency", {
  key: varchar("key", { length: 64 }).primaryKey(),
  providerCallId: varchar("providerCallId", { length: 128 }).notNull(),
  requestHash: varchar("requestHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CalleApiCallRecord = typeof calleApiCalls.$inferSelect;
export type CalleApiEventRecord = typeof calleApiEvents.$inferSelect;

export const billingAuditEvents = mysqlTable("billing_audit_events", {
  entryId: varchar("entryId", { length: 64 }).primaryKey(),
  actorUserId: int("actorUserId"),
  action: varchar("action", { length: 128 }).notNull(),
  correlationId: varchar("correlationId", { length: 64 }).notNull(),
  reason: text("reason").notNull(),
  payloadJson: text("payloadJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
