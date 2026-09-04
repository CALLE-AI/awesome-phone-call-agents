import type { D1Binding } from "./index";

const initialized = new WeakMap<object, Promise<void>>();

async function initialize(db: D1Binding): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sourcing_requests (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      part TEXT NOT NULL,
      fitment_reference TEXT NOT NULL,
      budget_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      delivery_location TEXT NOT NULL,
      needed_by TEXT NOT NULL,
      country_code TEXT NOT NULL,
      locale TEXT NOT NULL,
      recipient_consent_confirmed INTEGER NOT NULL DEFAULT 0,
      authorized_call_window TEXT NOT NULL DEFAULT 'No live call — fixture',
      history_access_hash TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sourcing_requests_created_at ON sourcing_requests (created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS request_suppliers (
      request_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      phone_masked TEXT NOT NULL,
      area TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (request_id, supplier_id),
      FOREIGN KEY (request_id) REFERENCES sourcing_requests(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_request_suppliers_request_id ON request_suppliers (request_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_approvals (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL,
      plan_fingerprint TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY (request_id) REFERENCES sourcing_requests(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_call_approvals_plan_fingerprint ON call_approvals (plan_fingerprint)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_call_approvals_request_id ON call_approvals (request_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_runs (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL,
      provider_call_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      task_completed INTEGER,
      confidence_score REAL,
      confidence_label TEXT,
      summary TEXT,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES sourcing_requests(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_call_runs_provider_call_id ON call_runs (provider_call_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_call_runs_request_created ON call_runs (request_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS supplier_quotes (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL,
      call_run_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      summary TEXT,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES sourcing_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (call_run_id) REFERENCES call_runs(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_quotes_run_supplier ON supplier_quotes (call_run_id, supplier_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_supplier_quotes_request_id ON supplier_quotes (request_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY NOT NULL,
      provider_call_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_call_id ON webhook_events (provider_call_id)"),
  ]);

  const { results: requestColumns } = await db
    .prepare("PRAGMA table_info(sourcing_requests)")
    .all<{ name: string }>();
  if (!requestColumns.some((column) => column.name === "history_access_hash")) {
    await db.batch([db.prepare("ALTER TABLE sourcing_requests ADD COLUMN history_access_hash TEXT")]);
  }
  if (!requestColumns.some((column) => column.name === "recipient_consent_confirmed")) {
    await db.batch([db.prepare("ALTER TABLE sourcing_requests ADD COLUMN recipient_consent_confirmed INTEGER NOT NULL DEFAULT 0")]);
  }
  if (!requestColumns.some((column) => column.name === "authorized_call_window")) {
    await db.batch([db.prepare("ALTER TABLE sourcing_requests ADD COLUMN authorized_call_window TEXT NOT NULL DEFAULT 'No live call — fixture'")]);
  }
  await db.batch([db.prepare("PRAGMA optimize")]);
}

export async function ensureSourcingStorage(db: D1Binding): Promise<void> {
  let pending = initialized.get(db as object);
  if (!pending) {
    pending = initialize(db);
    initialized.set(db as object, pending);
    pending.catch(() => initialized.delete(db as object));
  }
  await pending;
}
