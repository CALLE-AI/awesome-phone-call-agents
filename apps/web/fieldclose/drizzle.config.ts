import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

import { resolveDatabaseUrl } from "./src/config/database-url";

config({
  path: [".env.local", ".env"],
  quiet: true,
});

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/persistence/schema.ts",
  dbCredentials: {
    url: resolveDatabaseUrl(process.env.DATABASE_URL),
  },
  strict: true,
  verbose: true,
});
