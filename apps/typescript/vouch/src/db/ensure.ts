import type Database from "better-sqlite3";

function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string,
) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS consents (
      id TEXT PRIMARY KEY,
      candidate_name TEXT NOT NULL,
      employer TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      requested_json TEXT NOT NULL,
      consent_fields_json TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      consent_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      run_id TEXT,
      disposition TEXT,
      result_json TEXT,
      transcript_json TEXT,
      evidence_json TEXT,
      confidence_score TEXT,
      status TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES ('killed', '0');
  `);
  addColumnIfMissing(sqlite, "runs", "started_at", "started_at INTEGER");

  addColumnIfMissing(sqlite, "consents", "employer_id", "employer_id TEXT");
  addColumnIfMissing(sqlite, "consents", "requesting_org", "requesting_org TEXT");
  addColumnIfMissing(sqlite, "consents", "employer_code", "employer_code TEXT");
  addColumnIfMissing(sqlite, "consents", "phone_masked", "phone_masked TEXT");
  addColumnIfMissing(sqlite, "consents", "script_id", "script_id TEXT");
}