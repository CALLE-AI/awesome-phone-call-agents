import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const calleConnections = sqliteTable("calle_connections", {
  owner: text("owner").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  verifiedAt: text("verified_at").notNull(),
});

export const businesses = sqliteTable("businesses", {
  owner: text("owner").primaryKey(), settings: text("settings").notNull(), updatedAt: text("updated_at").notNull(),
});
export const intakeLinks = sqliteTable("intake_links", {
  owner: text("owner").primaryKey(), token: text("token").notNull(),
  enabled: integer("enabled").notNull().default(0), name: text("name").notNull(),
  introduction: text("introduction").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("idx_intake_token").on(t.token)]);
export const phoneLocks = sqliteTable("phone_locks", {
  id: text("id").primaryKey(), attemptId: text("attempt_id").notNull(), expiresAt: text("expires_at").notNull(),
});
export const inquiries = sqliteTable("inquiries", {
  id: text("id").primaryKey(), owner: text("owner").notNull(),
  name: text("name").notNull(), phone: text("phone").notNull(),
  source: text("source").notNull(), need: text("need").notNull(),
  timezone: text("timezone").notNull(), consent: integer("consent").notNull().default(0),
  consentNote: text("consent_note").notNull(), sample: integer("sample").notNull().default(0),
  status: text("status").notNull().default("new"), notes: text("notes").notNull().default(""),
  appointment: text("appointment").notNull().default(""), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("idx_inquiries_owner_created").on(t.owner,t.createdAt)]);
export const calls = sqliteTable("calls", {
  id: text("id").primaryKey(), owner: text("owner").notNull(),
  inquiryId: text("inquiry_id").notNull().references(()=>inquiries.id),
  providerId: text("provider_id"), status: text("status").notNull(),
  request: text("request").notNull(), result: text("result"), transcript: text("transcript").notNull().default("[]"),
  summary: text("summary").notNull().default(""), error: text("error").notNull().default(""),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t=>[uniqueIndex("idx_calls_inquiry").on(t.inquiryId),index("idx_calls_owner").on(t.owner)]);
