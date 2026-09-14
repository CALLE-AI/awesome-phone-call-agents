import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// Load node:sqlite through createRequire so bundlers/test runners (Vite/Vitest)
// don't try to statically resolve this native builtin. The type-only import
// above is erased at build time.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncCtor } = nodeRequire(
  "node:sqlite",
) as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  language TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  policy_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage_limit REAL,
  currency TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  policy_id TEXT,
  policyholder_name TEXT NOT NULL,
  claimant_phone TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  region TEXT NOT NULL,
  locale TEXT NOT NULL,
  language TEXT,
  provider_name TEXT,
  provider_phone TEXT,
  notes TEXT,
  autopilot INTEGER NOT NULL DEFAULT 0,
  report_sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_customer ON claims(customer_id);

CREATE TABLE IF NOT EXISTS call_intents (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  contact_id TEXT,
  call_type TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  destination_phone TEXT NOT NULL,
  region TEXT NOT NULL,
  locale TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  state TEXT NOT NULL,
  placed_by TEXT,
  reason TEXT,
  call_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE INDEX IF NOT EXISTS idx_intents_state ON call_intents(state);
CREATE INDEX IF NOT EXISTS idx_intents_claim ON call_intents(claim_id);
CREATE INDEX IF NOT EXISTS idx_intents_call ON call_intents(call_id);
CREATE INDEX IF NOT EXISTS idx_intents_contact ON call_intents(contact_id);

CREATE TABLE IF NOT EXISTS claim_contacts (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  region TEXT,
  locale TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_claim ON claim_contacts(claim_id);

CREATE TABLE IF NOT EXISTS claim_decisions (
  claim_id TEXT PRIMARY KEY,
  decided_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  sanctioned_amount REAL,
  currency TEXT,
  note TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE TABLE IF NOT EXISTS call_results (
  intent_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  status TEXT NOT NULL,
  task_completed INTEGER,
  confidence_score REAL,
  confidence_label TEXT,
  structured_result TEXT,
  evidence TEXT,
  summary TEXT,
  transcript TEXT,
  disposition TEXT NOT NULL,
  disposition_reason TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES call_intents(id)
);

CREATE TABLE IF NOT EXISTS inbox_entries (
  event_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS human_decisions (
  intent_id TEXT PRIMARY KEY,
  decided_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES call_intents(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_claim ON payments(claim_id);
`;

/**
 * Open (and migrate) the ClaimLine SQLite database. Uses Node's built-in
 * `node:sqlite`, so there is no native build step. Pass ":memory:" for tests.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSyncCtor(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Lightweight additive migrations for databases created by an earlier schema. */
function migrate(db: DatabaseSync): void {
  const columns = db
    .prepare("PRAGMA table_info(call_intents)")
    .all() as { name: string }[];
  if (!columns.some((c) => c.name === "contact_id")) {
    db.exec("ALTER TABLE call_intents ADD COLUMN contact_id TEXT");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_intents_contact ON call_intents(contact_id)",
    );
  }
  if (!columns.some((c) => c.name === "placed_by")) {
    db.exec("ALTER TABLE call_intents ADD COLUMN placed_by TEXT");
  }

  const contactCols = db
    .prepare("PRAGMA table_info(claim_contacts)")
    .all() as { name: string }[];
  if (!contactCols.some((c) => c.name === "region")) {
    db.exec("ALTER TABLE claim_contacts ADD COLUMN region TEXT");
  }
  if (!contactCols.some((c) => c.name === "locale")) {
    db.exec("ALTER TABLE claim_contacts ADD COLUMN locale TEXT");
  }

  const claimCols = db
    .prepare("PRAGMA table_info(claims)")
    .all() as { name: string }[];
  if (!claimCols.some((c) => c.name === "customer_id")) {
    db.exec("ALTER TABLE claims ADD COLUMN customer_id TEXT");
  }
  if (!claimCols.some((c) => c.name === "policy_id")) {
    db.exec("ALTER TABLE claims ADD COLUMN policy_id TEXT");
  }
  if (!claimCols.some((c) => c.name === "language")) {
    db.exec("ALTER TABLE claims ADD COLUMN language TEXT");
  }
  if (!claimCols.some((c) => c.name === "autopilot")) {
    db.exec("ALTER TABLE claims ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 0");
  }
  if (!claimCols.some((c) => c.name === "report_sent_at")) {
    db.exec("ALTER TABLE claims ADD COLUMN report_sent_at TEXT");
  }
}
