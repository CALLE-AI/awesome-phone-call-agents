import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './env.js';

const dbPath = path.resolve(process.cwd(), env.DATABASE_FILE);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Single source of truth for the schema. Idempotent — safe to run on every boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    default_language TEXT NOT NULL DEFAULT 'en-IN',
    default_region TEXT NOT NULL DEFAULT '+91',
    quiet_hours_start INTEGER NOT NULL DEFAULT 21,
    quiet_hours_end INTEGER NOT NULL DEFAULT 7,
    transcript_retention INTEGER NOT NULL DEFAULT 1,
    consent_snapshot TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Personal',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);

  CREATE TABLE IF NOT EXISTS authorized_numbers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    e164 TEXT NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, e164)
  );
  CREATE INDEX IF NOT EXISTS idx_authnum_user ON authorized_numbers(user_id);

  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    e164 TEXT NOT NULL,
    display_name TEXT NOT NULL,
    goal TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en-IN',
    archetype TEXT NOT NULL DEFAULT 'general',
    schedule_at INTEGER,
    extract_schema TEXT NOT NULL,
    consent_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    calle_call_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    task_string TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_missions_user_status ON missions(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_missions_calle ON missions(calle_call_id);

  CREATE TABLE IF NOT EXISTS briefs (
    mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL,
    summary_for_user TEXT NOT NULL,
    facts TEXT NOT NULL DEFAULT '{}',
    next_step TEXT,
    callee_role TEXT,
    confidence REAL,
    evidence TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mission_events (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    t INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_mission ON mission_events(mission_id, seq);

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

  CREATE TABLE IF NOT EXISTS rate_limit_log (
    user_id TEXT NOT NULL,
    started_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rate_user_time ON rate_limit_log(user_id, started_at);
`);

export type DB = typeof db;
