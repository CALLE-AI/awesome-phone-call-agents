import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? `file:${process.env.SQLITE_PATH ?? "./local.db"}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
