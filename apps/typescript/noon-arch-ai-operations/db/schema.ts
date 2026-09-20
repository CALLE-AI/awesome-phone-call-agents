import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company").notNull(),
  phone: text("phone").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const workflows = sqliteTable("workflows", {
  id: integer("id").primaryKey(),
  projectName: text("project_name").notNull(),
  followUpItems: text("follow_up_items").notNull(),
  settingsJson: text("settings_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const callRecords = sqliteTable("call_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  calleCallId: text("calle_call_id"),
  contactId: integer("contact_id"),
  recipientName: text("recipient_name").notNull(),
  phoneLastFour: text("phone_last_four").notNull(),
  workflow: text("workflow").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  resultJson: text("result_json"),
  evidenceJson: text("evidence_json"),
  transcriptJson: text("transcript_json"),
  confidencePercent: integer("confidence_percent"),
  completedAt: text("completed_at"),
  confirmationId: text("confirmation_id").unique(),
  initiatedBy: text("initiated_by").notNull().default("manual_confirmation"),
  automaticFollowUp: integer("automatic_follow_up", { mode: "boolean" }).notNull().default(false),
  sourceContextJson: text("source_context_json"),
  writebackStatus: text("writeback_status"),
  writebackAt: text("writeback_at"),
  createdAt: text("created_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  ownerId: text("owner_id").primaryKey(),
  settingsJson: text("settings_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const integrationConnections = sqliteTable("integration_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  authMode: text("auth_mode").notNull(),
  credentialCiphertext: text("credential_ciphertext").notNull(),
  credentialIv: text("credential_iv").notNull(),
  status: text("status").notNull().default("connected"),
  settingsJson: text("settings_json").notNull().default("{}"),
  lastTestedAt: text("last_tested_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("integration_connections_owner_provider_unique").on(table.ownerId, table.provider),
]);

export const integrationBindings = sqliteTable("integration_bindings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  connectionId: integer("connection_id").notNull(),
  serviceKey: text("service_key").notNull(),
  sourceId: text("source_id").notNull(),
  sourceName: text("source_name").notNull(),
  mappingJson: text("mapping_json").notNull().default("{}"),
  filtersJson: text("filters_json").notNull().default("{}"),
  syncMode: text("sync_mode").notNull().default("manual"),
  writebackEnabled: integer("writeback_enabled", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("integration_bindings_owner_service_unique").on(table.ownerId, table.serviceKey),
]);
