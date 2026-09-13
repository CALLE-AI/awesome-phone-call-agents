import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "service-rescue.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS call_records (
    call_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    service_type TEXT NOT NULL,
    masked_provider TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    event TEXT NOT NULL,
    call_id TEXT,
    status TEXT,
    detail TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    call_id TEXT NOT NULL,
    received_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workflow_requests (
    idempotency_key TEXT PRIMARY KEY,
    call_id TEXT,
    service_type TEXT NOT NULL,
    masked_provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`);

export function recordCall({ callId, idempotencyKey, serviceType, maskedProvider, status }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO call_records (call_id, idempotency_key, service_type, masked_provider, consented_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(call_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).run(callId, idempotencyKey, serviceType, maskedProvider, now, status, now, now);
}
export function updateCallStatus(callId, status) {
  db.prepare("UPDATE call_records SET status = ?, updated_at = ? WHERE call_id = ?").run(status, new Date().toISOString(), callId);
}
export function addAudit(event, { callId = null, status = null, detail = null } = {}) {
  db.prepare("INSERT INTO audit_events (at, event, call_id, status, detail) VALUES (?, ?, ?, ?, ?)").run(new Date().toISOString(), event, callId, status, detail);
}
export function recentAudit() {
  return db.prepare("SELECT at, event, call_id AS callId, status, detail FROM audit_events ORDER BY id DESC LIMIT 20").all();
}
export function recordWebhookEvent({ eventId, eventType, callId }) {
  const result = db.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, call_id, received_at) VALUES (?, ?, ?, ?)").run(eventId, eventType, callId, new Date().toISOString());
  return result.changes === 1;
}
export function reserveWorkflow({ idempotencyKey, serviceType, maskedProvider }) {
  const existing = db.prepare("SELECT call_id AS callId FROM workflow_requests WHERE idempotency_key = ?").get(idempotencyKey);
  if (existing) return existing;
  db.prepare("INSERT INTO workflow_requests (idempotency_key, call_id, service_type, masked_provider, created_at) VALUES (?, NULL, ?, ?, ?)").run(idempotencyKey, serviceType, maskedProvider, new Date().toISOString());
  return { callId: null };
}
export function attachCallToWorkflow(idempotencyKey, callId) {
  db.prepare("UPDATE workflow_requests SET call_id = ? WHERE idempotency_key = ?").run(callId, idempotencyKey);
}
