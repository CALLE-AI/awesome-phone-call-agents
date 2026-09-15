import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agency: text("agency").notNull(),
  timezone: text("timezone").notNull(),
  callbackNumber: text("callback_number").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  questionsJson: text("questions_json").notNull(),
  taskText: text("task_text").notNull(),
});

export const roster = sqliteTable("roster", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  displayName: text("display_name").notNull(),
  phoneMasked: text("phone_masked").notNull(),
  phoneE164: text("phone_e164").notNull(),
  region: text("region").notNull(),
  locale: text("locale").notNull(),
  timezone: text("timezone").notNull(),
  householdSize: integer("household_size"),
  flagsJson: text("flags_json").notNull().default("[]"),
});

export const waves = sqliteTable("waves", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  waveNo: integer("wave_no").notNull(),
  filterJson: text("filter_json").notNull(),
  budgetCap: integer("budget_cap").notNull(),
  status: text("status").notNull(),
});

export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  waveId: text("wave_id").notNull(),
  rosterEntryId: text("roster_entry_id").notNull(),
  runId: text("run_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  disposition: text("disposition"),
  resultJson: text("result_json"),
  transcriptJson: text("transcript_json"),
  evidenceJson: text("evidence_json"),
  confidenceScore: text("confidence_score"),
  status: text("status").notNull(),
  startedAt: integer("started_at"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const triageCards = sqliteTable("triage_cards", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  rosterEntryId: text("roster_entry_id").notNull(),
  severity: text("severity").notNull(),
  needsJson: text("needs_json").notNull(),
  assignee: text("assignee"),
  status: text("status").notNull(),
});
