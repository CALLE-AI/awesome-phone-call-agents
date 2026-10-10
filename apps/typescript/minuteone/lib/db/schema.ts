import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { BusinessConfig } from "../config/schema";

export const leadStatusValues = [
  "pending",
  "in_progress",
  "done",
  "failed",
] as const;

/** Single-tenant: exactly one row, id always "singleton" — see lib/config/load.ts. */
export const businessConfig = sqliteTable("business_config", {
  id: text("id").primaryKey(),
  config: text("config", { mode: "json" }).$type<BusinessConfig>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),

  // Intake
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  notes: text("notes"),
  source: text("source").notNull().default("hosted_form"),
  consent: integer("consent", { mode: "boolean" }).notNull(),

  // Dispatch state
  status: text("status", { enum: leadStatusValues }).notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),

  // LeadCard (populated once a call completes)
  outcome: text("outcome"),
  answers: text("answers", { mode: "json" }).$type<{ questionId: string; value: string }[]>(),
  score: integer("score"),
  summary: text("summary"),
  nextAction: text("next_action"),
  callId: text("call_id"),
  durationS: integer("duration_s"),
  transcriptRef: text("transcript_ref"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type LeadRow = typeof leads.$inferSelect;
export type NewLeadRow = typeof leads.$inferInsert;
export type BusinessConfigRow = typeof businessConfig.$inferSelect;
