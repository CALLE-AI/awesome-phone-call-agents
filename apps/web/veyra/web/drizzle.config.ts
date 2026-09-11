import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js reads .env.local automatically; drizzle-kit runs outside Next, so it needs
// telling explicitly.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
