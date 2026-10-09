import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureSchema } from "./ensure";
import * as schema from "./schema";

export const dbFile = process.env.HEADCOUNT_DB ?? join(process.cwd(), "data/headcount.db");

mkdirSync(dirname(dbFile), { recursive: true });

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
ensureSchema(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };
