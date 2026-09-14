import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  // Nullable: only used for the earlier Google-OAuth-based flow. Public
  // signups (app/api/users/create) don't collect an email address.
  email: text("email").unique(),
  name: text("name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  // Nullable: unset until the user picks a time via
  // app/api/users/[userId]/schedule.
  callTime: text("call_time"),
  // Nullable: Gmail OAuth is out of scope for this demo (see lib/mockInbox.ts
  // and lib/emailSource.ts), so these are unused for seeded demo users.
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleTokenExpiry: integer("google_token_expiry", {
    mode: "timestamp",
  }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const emails = sqliteTable("emails", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  gmailMessageId: text("gmail_message_id").notNull(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  // Nullable: filled in by the OpenRouter classification step, not at
  // ingest time.
  summary: text("summary"),
  category: text("category"),
  urgency: text("urgency"),
  // True whenever classifyEmail fell back to defaults after an API/parse
  // error, so the fetch route knows to retry classification later instead
  // of treating the fallback "other"/"low" values as a real classification.
  classificationFailed: integer("classification_failed", { mode: "boolean" })
    .notNull()
    .default(false),
  dueDate: integer("due_date", { mode: "timestamp" }),
  decision: text("decision"),
  decisionDetail: text("decision_detail"),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  emailId: text("email_id")
    .notNull()
    .references(() => emails.id),
  remindAt: integer("remind_at", { mode: "timestamp" }).notNull(),
  fired: integer("fired", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const callLogs = sqliteTable("call_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  callType: text("call_type").notNull(),
  calleCallId: text("calle_call_id"),
  status: text("status").notNull().default("pending"),
  structuredResult: text("structured_result"),
  transcript: text("transcript"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

export type CallLog = typeof callLogs.$inferSelect;
export type NewCallLog = typeof callLogs.$inferInsert;
