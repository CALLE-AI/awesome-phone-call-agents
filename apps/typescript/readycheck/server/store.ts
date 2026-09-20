import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaseRecord } from '../src/domain/model';

export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DATABASE_PATH || './data/readycheck.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password TEXT, guest INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), owner_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, approved_at TEXT, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inquiries(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), candidate_id TEXT NOT NULL, owner_id TEXT NOT NULL, state TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, vendor_id TEXT UNIQUE, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_poll TEXT, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(plan_id,candidate_id));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, inquiry_id TEXT, type TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS budgets(inquiry_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, day TEXT NOT NULL, released INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS provider_results(inquiry_id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_checks(owner_id TEXT PRIMARY KEY REFERENCES users(id), key_hash TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS correction_feedback(owner_id TEXT NOT NULL REFERENCES users(id), case_id TEXT NOT NULL REFERENCES cases(id), source_id TEXT NOT NULL, fact_id TEXT NOT NULL, rule TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected')), updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,case_id,source_id,fact_id,rule));
      CREATE INDEX IF NOT EXISTS cases_owner ON cases(owner_id,deleted);
      CREATE INDEX IF NOT EXISTS inquiries_state ON inquiries(state,next_poll);
      CREATE INDEX IF NOT EXISTS events_inquiry_type ON events(inquiry_id,type);
    `);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  getCase(id: string, owner: string): CaseRecord | null {
    const row = this.db
      .prepare('SELECT data FROM cases WHERE id=? AND owner_id=? AND deleted=0')
      .get(id, owner);
    return row ? JSON.parse(row.data as string) : null;
  }
  saveCase(owner: string, value: CaseRecord) {
    this.db
      .prepare(
        'INSERT INTO cases(id,owner_id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE cases.owner_id=excluded.owner_id AND cases.deleted=0',
      )
      .run(value.id, owner, JSON.stringify(value), value.updatedAt);
  }
  listCases(owner: string): CaseRecord[] {
    return this.db
      .prepare('SELECT data FROM cases WHERE owner_id=? AND deleted=0 ORDER BY updated_at DESC')
      .all(owner)
      .map((r) => JSON.parse(r.data as string));
  }
  event(inquiry: string | null, type: string, detail = '') {
    this.db
      .prepare('INSERT INTO events VALUES(?,?,?,?,?)')
      .run(randomUUID(), inquiry, type, new Date().toISOString(), detail);
  }
  close() {
    this.db.close();
  }
}
