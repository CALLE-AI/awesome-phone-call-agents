import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sourcingRequests = sqliteTable(
  "sourcing_requests",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    executionMode: text("execution_mode").notNull(),
    vehicle: text("vehicle").notNull(),
    part: text("part").notNull(),
    fitmentReference: text("fitment_reference").notNull(),
    budgetAmount: real("budget_amount").notNull(),
    currency: text("currency").notNull(),
    deliveryLocation: text("delivery_location").notNull(),
    neededBy: text("needed_by").notNull(),
    countryCode: text("country_code").notNull(),
    locale: text("locale").notNull(),
    recipientConsentConfirmed: integer("recipient_consent_confirmed", { mode: "boolean" }).notNull().default(false),
    authorizedCallWindow: text("authorized_call_window").notNull().default("No live call — fixture"),
    historyAccessHash: text("history_access_hash"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_sourcing_requests_created_at").on(table.createdAt)],
);

export const requestSuppliers = sqliteTable(
  "request_suppliers",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => sourcingRequests.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id").notNull(),
    name: text("name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    phoneMasked: text("phone_masked").notNull(),
    area: text("area"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.requestId, table.supplierId] }),
    index("idx_request_suppliers_request_id").on(table.requestId),
  ],
);

export const callApprovals = sqliteTable(
  "call_approvals",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => sourcingRequests.id, { onDelete: "cascade" }),
    planFingerprint: text("plan_fingerprint").notNull(),
    approvedAt: text("approved_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    uniqueIndex("idx_call_approvals_plan_fingerprint").on(table.planFingerprint),
    index("idx_call_approvals_request_id").on(table.requestId),
  ],
);

export const callRuns = sqliteTable(
  "call_runs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => sourcingRequests.id, { onDelete: "cascade" }),
    providerCallId: text("provider_call_id").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    taskCompleted: integer("task_completed", { mode: "boolean" }),
    confidenceScore: real("confidence_score"),
    confidenceLabel: text("confidence_label"),
    summary: text("summary"),
    evidenceJson: text("evidence_json").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_call_runs_provider_call_id").on(table.providerCallId),
    index("idx_call_runs_request_created").on(table.requestId, table.createdAt),
  ],
);

export const supplierQuotes = sqliteTable(
  "supplier_quotes",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => sourcingRequests.id, { onDelete: "cascade" }),
    callRunId: text("call_run_id")
      .notNull()
      .references(() => callRuns.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    summary: text("summary"),
    evidenceJson: text("evidence_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_supplier_quotes_run_supplier").on(table.callRunId, table.supplierId),
    index("idx_supplier_quotes_request_id").on(table.requestId),
  ],
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    providerCallId: text("provider_call_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [index("idx_webhook_events_provider_call_id").on(table.providerCallId)],
);
