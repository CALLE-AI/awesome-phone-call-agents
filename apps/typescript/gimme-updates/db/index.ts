import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const sqlite = new Database(databaseUrl);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

export * from "./schema";
