import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  AdministrativeResults,
  AnswerValue,
  CallingWindow,
  PreferredWindow,
  RedactedAuditMetadata,
  VisitContext,
} from "@/domain/contracts";
import {
  attemptOutcomeValues,
  auditActorTypeValues,
  authorizationBasisValues,
  callModeValues,
  caseStatusValues,
  contactVerificationValues,
  creationDispositionValues,
  followUpTaskStatusValues,
  followUpTaskTypeValues,
  humanDispositionOutcomeValues,
  observedOperatingStatusValues,
  providerNameValues,
  providerTaskStatusValues,
  resultRouteValues,
  workspaceKindValues,
  workspaceRoleValues,
} from "@/domain/enums";

export const caseStatusEnum = pgEnum("case_status", caseStatusValues);
export const authorizationBasisEnum = pgEnum(
  "authorization_basis",
  authorizationBasisValues,
);
export const callModeEnum = pgEnum("call_mode", callModeValues);
export const providerNameEnum = pgEnum("provider_name", providerNameValues);
export const workspaceKindEnum = pgEnum("workspace_kind", workspaceKindValues);
export const workspaceRoleEnum = pgEnum("workspace_role", workspaceRoleValues);
export const providerTaskStatusEnum = pgEnum(
  "provider_task_status",
  providerTaskStatusValues,
);
export const attemptOutcomeEnum = pgEnum(
  "attempt_outcome",
  attemptOutcomeValues,
);
export const creationDispositionEnum = pgEnum(
  "creation_disposition",
  creationDispositionValues,
);
export const contactVerificationEnum = pgEnum(
  "contact_verification",
  contactVerificationValues,
);
export const observedOperatingStatusEnum = pgEnum(
  "observed_operating_status",
  observedOperatingStatusValues,
);
export const resultRouteEnum = pgEnum("result_route", resultRouteValues);
export const followUpTaskTypeEnum = pgEnum(
  "follow_up_task_type",
  followUpTaskTypeValues,
);
export const followUpTaskStatusEnum = pgEnum(
  "follow_up_task_status",
  followUpTaskStatusValues,
);
export const humanDispositionOutcomeEnum = pgEnum(
  "human_disposition_outcome",
  humanDispositionOutcomeValues,
);
export const auditActorTypeEnum = pgEnum(
  "audit_actor_type",
  auditActorTypeValues,
);
// Generated from the Better Auth configuration with `auth@1.6.25 generate`.
// Keep the exported model names stable because the Drizzle adapter resolves
// these names at runtime.
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("user_username_uq").on(table.username)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaces = pgTable(
  "workspace",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    kind: workspaceKindEnum("kind").default("demo").notNull(),
    provider: providerNameEnum("provider").default("fake").notNull(),
    liveCallsAllowed: boolean("live_calls_allowed").default(false).notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_slug_uq").on(table.slug),
    index("workspace_owner_kind_idx").on(table.ownerUserId, table.kind),
    check(
      "workspace_demo_fake_only_ck",
      sql`${table.kind} <> 'demo' or (${table.provider} = 'fake' and ${table.liveCallsAllowed} = false)`,
    ),
  ],
);

export const workspaceMemberships = pgTable(
  "workspace_membership",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_membership_workspace_user_uq").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_membership_user_idx").on(table.userId, table.workspaceId),
  ],
);

export const workspaceAdministrativeEvents = pgTable(
  "workspace_administrative_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, boolean | string>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workspace_admin_event_workspace_occurred_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
  ],
);

export const contacts = pgTable(
  "contact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 120 }),
    role: varchar("role", { length: 64 }).notNull(),
    phoneE164Ciphertext: text("phone_e164_ciphertext").notNull(),
    phoneEncryptionIv: varchar("phone_encryption_iv", { length: 32 }).notNull(),
    phoneEncryptionTag: varchar("phone_encryption_tag", { length: 32 }).notNull(),
    phoneKeyVersion: varchar("phone_key_version", { length: 32 }).notNull(),
    phoneLookupHash: varchar("phone_lookup_hash", { length: 64 }).notNull(),
    phoneMasked: varchar("phone_masked", { length: 32 }).notNull(),
    authorizationBasis: authorizationBasisEnum("authorization_basis").notNull(),
    authorizationNote: varchar("authorization_note", { length: 500 }).notNull(),
    doNotCallAt: timestamp("do_not_call_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("contact_id_workspace_uq").on(table.id, table.workspaceId),
    index("contact_phone_lookup_hash_idx").on(table.phoneLookupHash),
    check(
      "contact_phone_masked_not_blank_ck",
      sql`length(trim(${table.phoneMasked})) > 0`,
    ),
  ],
);

export const closeoutCases = pgTable(
  "closeout_case",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    version: integer("version").default(1).notNull(),
    status: caseStatusEnum("status").default("draft").notNull(),
    workOrderRef: varchar("work_order_ref", { length: 80 }).notNull(),
    contractorDisplayName: varchar("contractor_display_name", {
      length: 120,
    }).notNull(),
    siteLabel: varchar("site_label", { length: 160 }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    contactId: uuid("contact_id").notNull(),
    requestedFields: jsonb("requested_fields").$type<string[]>().notNull(),
    visitContext: jsonb("visit_context").$type<VisitContext>().notNull(),
    currentAttemptId: uuid("current_attempt_id").references(
      (): AnyPgColumn => callAttempts.id,
      { onDelete: "set null" },
    ),
    createdBy: varchar("created_by", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp("cancelled_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "closeout_case_contact_workspace_fk",
      columns: [table.contactId, table.workspaceId],
      foreignColumns: [contacts.id, contacts.workspaceId],
    }).onDelete("restrict"),
    uniqueIndex("closeout_case_workspace_work_order_ref_uq").on(
      table.workspaceId,
      table.workOrderRef,
    ),
    uniqueIndex("closeout_case_current_attempt_uq")
      .on(table.currentAttemptId)
      .where(sql`${table.currentAttemptId} is not null`),
    index("closeout_case_status_updated_idx").on(table.status, table.updatedAt),
    check("closeout_case_version_positive_ck", sql`${table.version} > 0`),
    check(
      "closeout_case_requested_fields_nonempty_ck",
      sql`jsonb_typeof(${table.requestedFields}) = 'array' and jsonb_array_length(${table.requestedFields}) > 0`,
    ),
  ],
);

export const callAttempts = pgTable(
  "call_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(
      (): AnyPgColumn => callApprovals.id,
    ),
    mode: callModeEnum("mode").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    provider: providerNameEnum("provider").notNull(),
    providerCallId: varchar("provider_call_id", { length: 200 }),
    providerTaskStatus: providerTaskStatusEnum("provider_task_status")
      .default("not_created")
      .notNull(),
    attemptOutcome: attemptOutcomeEnum("attempt_outcome")
      .default("not_determined")
      .notNull(),
    creationDisposition: creationDispositionEnum("creation_disposition")
      .default("not_requested")
      .notNull(),
    requestedAt: timestamp("requested_at", {
      mode: "date",
      withTimezone: true,
    }),
    acceptedAt: timestamp("accepted_at", {
      mode: "date",
      withTimezone: true,
    }),
    connectedAt: timestamp("connected_at", {
      mode: "date",
      withTimezone: true,
    }),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", {
      mode: "date",
      withTimezone: true,
    }),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("call_attempt_id_case_uq").on(table.id, table.caseId),
    uniqueIndex("call_attempt_idempotency_key_uq").on(table.idempotencyKey),
    uniqueIndex("call_attempt_provider_call_id_uq")
      .on(table.providerCallId)
      .where(sql`${table.providerCallId} is not null`),
    index("call_attempt_case_created_idx").on(table.caseId, table.createdAt),
    index("call_attempt_reconciliation_idx").on(
      table.creationDisposition,
      table.lastCheckedAt,
    ),
    check(
      "call_attempt_live_requires_approval_ck",
      sql`${table.mode} <> 'live' or ${table.approvalId} is not null`,
    ),
  ],
);

export const callApprovals = pgTable(
  "call_approval",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    caseVersion: integer("case_version").notNull(),
    approvedAttemptId: uuid("approved_attempt_id").notNull(),
    approvedBy: varchar("approved_by", { length: 128 }).notNull(),
    approvedAt: timestamp("approved_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", {
      mode: "date",
      withTimezone: true,
    }),
    briefHash: varchar("brief_hash", { length: 64 }).notNull(),
    liveCallApproved: boolean("live_call_approved").default(false).notNull(),
    callingWindow: jsonb("calling_window").$type<CallingWindow>().notNull(),
    operatorAttestations: jsonb("operator_attestations")
      .$type<string[]>()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "call_approval_attempt_case_fk",
      columns: [table.approvedAttemptId, table.caseId],
      foreignColumns: [callAttempts.id, callAttempts.caseId],
    }),
    unique("call_approval_identity_scope_uq").on(
      table.id,
      table.caseId,
      table.approvedAttemptId,
    ),
    uniqueIndex("call_approval_attempt_uq").on(table.approvedAttemptId),
    index("call_approval_case_approved_idx").on(table.caseId, table.approvedAt),
    check("call_approval_case_version_positive_ck", sql`${table.caseVersion} > 0`),
    check(
      "call_approval_attestations_nonempty_ck",
      sql`jsonb_typeof(${table.operatorAttestations}) = 'array' and jsonb_array_length(${table.operatorAttestations}) > 0`,
    ),
  ],
);

export const callResults = pgTable(
  "call_result",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").notNull(),
    providerCallId: varchar("provider_call_id", { length: 200 }),
    providerTaskStatus: providerTaskStatusEnum("provider_task_status").notNull(),
    contactVerification: contactVerificationEnum("contact_verification").notNull(),
    observedOperatingStatus: observedOperatingStatusEnum(
      "observed_operating_status",
    ).notNull(),
    unresolvedIssue: jsonb("unresolved_issue").$type<AnswerValue>().notNull(),
    returnVisitRequested: jsonb("return_visit_requested")
      .$type<AnswerValue>()
      .notNull(),
    preferredWindows: jsonb("preferred_windows")
      .$type<PreferredWindow[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    administrativeResults: jsonb("administrative_results")
      .$type<AdministrativeResults>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    outOfScopeTopics: jsonb("out_of_scope_topics")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    escalationReasons: jsonb("escalation_reasons")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    summary: varchar("summary", { length: 1_000 }).notNull(),
    evidenceRefs: jsonb("evidence_refs")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    route: resultRouteEnum("route").notNull(),
    normalizerVersion: varchar("normalizer_version", { length: 40 }).notNull(),
    normalizedAt: timestamp("normalized_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "call_result_attempt_case_fk",
      columns: [table.attemptId, table.caseId],
      foreignColumns: [callAttempts.id, callAttempts.caseId],
    }).onDelete("cascade"),
    uniqueIndex("call_result_attempt_uq").on(table.attemptId),
    index("call_result_case_normalized_idx").on(table.caseId, table.normalizedAt),
  ],
);

export const followUpTasks = pgTable(
  "follow_up_task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    type: followUpTaskTypeEnum("type").notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
    status: followUpTaskStatusEnum("status").default("open").notNull(),
    assignedTo: varchar("assigned_to", { length: 128 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", {
      mode: "date",
      withTimezone: true,
    }),
    resolutionNote: varchar("resolution_note", { length: 1_000 }),
  },
  (table) => [
    unique("follow_up_task_id_case_uq").on(table.id, table.caseId),
    index("follow_up_task_queue_idx").on(table.status, table.createdAt),
    check(
      "follow_up_task_reason_codes_nonempty_ck",
      sql`jsonb_typeof(${table.reasonCodes}) = 'array' and jsonb_array_length(${table.reasonCodes}) > 0`,
    ),
  ],
);

export const humanDispositions = pgTable(
  "human_disposition",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    outcome: humanDispositionOutcomeEnum("outcome").notNull(),
    resolutionNote: varchar("resolution_note", { length: 1_000 }),
    recordedBy: varchar("recorded_by", { length: 128 }).notNull(),
    recordedAt: timestamp("recorded_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "human_disposition_task_case_fk",
      columns: [table.taskId, table.caseId],
      foreignColumns: [followUpTasks.id, followUpTasks.caseId],
    }).onDelete("restrict"),
    uniqueIndex("human_disposition_case_uq").on(table.caseId),
    uniqueIndex("human_disposition_task_uq").on(table.taskId),
    index("human_disposition_recorded_idx").on(table.recordedAt),
    check(
      "human_disposition_note_not_blank_ck",
      sql`${table.resolutionNote} is null or length(trim(${table.resolutionNote})) > 0`,
    ),
    check(
      "human_disposition_handoff_note_required_ck",
      sql`${table.outcome} not in ('return_visit_handoff', 'manual_follow_up_handoff') or ${table.resolutionNote} is not null`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => closeoutCases.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id"),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 128 }),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata")
      .$type<RedactedAuditMetadata>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "audit_event_attempt_case_fk",
      columns: [table.attemptId, table.caseId],
      foreignColumns: [callAttempts.id, callAttempts.caseId],
    }),
    index("audit_event_case_occurred_idx").on(table.caseId, table.occurredAt),
    index("audit_event_attempt_occurred_idx").on(
      table.attemptId,
      table.occurredAt,
    ),
  ],
);

export const systemSettings = pgTable("system_setting", {
  key: varchar("key", { length: 80 }).primaryKey(),
  booleanValue: boolean("boolean_value").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedBy: varchar("updated_by", { length: 128 }).notNull(),
});

export type ContactRecord = typeof contacts.$inferSelect;
export type NewContactRecord = typeof contacts.$inferInsert;
export type CloseoutCaseRecord = typeof closeoutCases.$inferSelect;
export type NewCloseoutCaseRecord = typeof closeoutCases.$inferInsert;
export type CallAttemptRecord = typeof callAttempts.$inferSelect;
export type NewCallAttemptRecord = typeof callAttempts.$inferInsert;
export type HumanDispositionRecord = typeof humanDispositions.$inferSelect;
export type NewHumanDispositionRecord = typeof humanDispositions.$inferInsert;
