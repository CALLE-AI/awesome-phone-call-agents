import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { ensureSchema } from "./ensure";

export const dbFile = process.env.VOUCH_DB ?? join(process.cwd(), "data/vouch.db");

mkdirSync(dirname(dbFile), { recursive: true });

export const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
ensureSchema(sqlite);
