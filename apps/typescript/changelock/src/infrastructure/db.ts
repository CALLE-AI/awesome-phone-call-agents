import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AuditEvent,
  CallIntent,
  CallSnapshotRow,
  ChangeRequest,
  TrustedContact,
  Vendor,
  VerificationCase,
} from "../domain/types";
import type { CaseState } from "../domain/types";

export type Db = Database.Database;

export function openDatabase(path?: string): Db {
  const target = path ?? process.env.CHANGELOCK_DB_PATH ?? "./data/changelock.db";
  if (target !== ":memory:") {
    mkdirSync(dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      vendor_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('active','suspended'))
    );
    CREATE TABLE IF NOT EXISTS trusted_contacts (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      region TEXT NOT NULL,
      locale TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'erp_vendor_master',
      verified_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_contact_per_vendor
      ON trusted_contacts(vendor_id) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      external_event_id TEXT NOT NULL UNIQUE,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      requested_at TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      request_contact_name TEXT NOT NULL,
      request_contact_phone_masked TEXT NOT NULL,
      new_destination_label TEXT NOT NULL,
      change_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held' CHECK (status = 'held')
    );
    CREATE TABLE IF NOT EXISTS verification_cases (
      id TEXT PRIMARY KEY,
      change_request_id TEXT NOT NULL UNIQUE REFERENCES change_requests(id),
      state TEXT NOT NULL,
      safe_case_code TEXT NOT NULL,
      current_intent_id TEXT,
      preview_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_intents (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES verification_cases(id),
      version INTEGER NOT NULL,
      trusted_contact_id TEXT NOT NULL REFERENCES trusted_contacts(id),
      task_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      task_text TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      destination_fingerprint TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      operator_attestation INTEGER NOT NULL DEFAULT 0,
      provider_call_id TEXT UNIQUE,
      provider_mode TEXT NOT NULL CHECK (provider_mode IN ('replay','live')),
      status TEXT NOT NULL CHECK (status IN ('reserved','dispatched','expired')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_snapshots (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES call_intents(id),
      provider_call_id TEXT NOT NULL,
      provider_status TEXT NOT NULL,
      task_completed INTEGER,
      recipient_status TEXT,
      confidence_score REAL,
      structured_result_json TEXT,
      evidence_json TEXT NOT NULL,
      received_at TEXT NOT NULL,
      verification_mode TEXT NOT NULL CHECK (verification_mode IN ('replay','live'))
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES verification_cases(id),
      type TEXT NOT NULL,
      actor TEXT NOT NULL,
      safe_payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      previous_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE
    );
  `);
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function row<T>(r: unknown): T {
  return r as T;
}

export function getVendorByCode(db: Db, code: string): Vendor | null {
  const r = db
    .prepare("SELECT id, display_name displayName, vendor_code vendorCode, status FROM vendors WHERE vendor_code = ?")
    .get(code);
  return r ? row<Vendor>(r) : null;
}

export function insertVendor(db: Db, v: Vendor): void {
  db.prepare(
    "INSERT INTO vendors (id, display_name, vendor_code, status) VALUES (?,?,?,?)",
  ).run(v.id, v.displayName, v.vendorCode, v.status);
}

export function insertTrustedContact(db: Db, c: TrustedContact): void {
  db.prepare(
    `INSERT INTO trusted_contacts
     (id, vendor_id, name, role, phone_e164, region, locale, source, verified_at, active)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    c.id, c.vendorId, c.name, c.role, c.phoneE164, c.region, c.locale,
    c.source, c.verifiedAt, c.active ? 1 : 0,
  );
}

interface ContactRow extends Omit<TrustedContact, "active"> {
  active: number;
}

export function getTrustedContact(db: Db, id: string): TrustedContact | null {
  const r = db
    .prepare(
      `SELECT id, vendor_id vendorId, name, role, phone_e164 phoneE164, region, locale,
              source, verified_at verifiedAt, active
       FROM trusted_contacts WHERE id = ?`,
    )
    .get(id) as ContactRow | undefined;
  return r ? { ...r, active: r.active === 1 } : null;
}

export function getActiveTrustedContact(db: Db, vendorId: string): TrustedContact | null {
  const r = db
    .prepare(
      `SELECT id, vendor_id vendorId, name, role, phone_e164 phoneE164, region, locale,
              source, verified_at verifiedAt, active
       FROM trusted_contacts WHERE vendor_id = ? AND active = 1`,
    )
    .get(vendorId) as ContactRow | undefined;
  return r ? { ...r, active: true } : null;
}

export function insertChangeRequest(db: Db, c: ChangeRequest): void {
  db.prepare(
    `INSERT INTO change_requests
     (id, external_event_id, vendor_id, requested_at, source_system, source_reference,
      request_contact_name, request_contact_phone_masked, new_destination_label,
      change_fingerprint, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,'held')`,
  ).run(
    c.id, c.externalEventId, c.vendorId, c.requestedAt, c.sourceSystem,
    c.sourceReference, c.requestContactName, c.requestContactPhoneMasked,
    c.newDestinationLabel, c.changeFingerprint,
  );
}

export function getChangeRequestByExternalEventId(db: Db, externalEventId: string): ChangeRequest | null {
  const r = db
    .prepare(
      `SELECT id, external_event_id externalEventId, vendor_id vendorId, requested_at requestedAt,
              source_system sourceSystem, source_reference sourceReference,
              request_contact_name requestContactName,
              request_contact_phone_masked requestContactPhoneMasked,
              new_destination_label newDestinationLabel, change_fingerprint changeFingerprint, status
       FROM change_requests WHERE external_event_id = ?`,
    )
    .get(externalEventId);
  return r ? row<ChangeRequest>(r) : null;
}

export function getChangeRequest(db: Db, id: string): ChangeRequest | null {
  const r = db
    .prepare(
      `SELECT id, external_event_id externalEventId, vendor_id vendorId, requested_at requestedAt,
              source_system sourceSystem, source_reference sourceReference,
              request_contact_name requestContactName,
              request_contact_phone_masked requestContactPhoneMasked,
              new_destination_label newDestinationLabel, change_fingerprint changeFingerprint, status
       FROM change_requests WHERE id = ?`,
    )
    .get(id);
  return r ? row<ChangeRequest>(r) : null;
}

export function listChangeRequests(db: Db): (ChangeRequest & { caseId: string; caseState: CaseState; safeCaseCode: string; vendorName: string })[] {
  return db
    .prepare(
      `SELECT cr.id, cr.external_event_id externalEventId, cr.vendor_id vendorId,
              cr.requested_at requestedAt, cr.source_system sourceSystem,
              cr.source_reference sourceReference, cr.request_contact_name requestContactName,
              cr.request_contact_phone_masked requestContactPhoneMasked,
              cr.new_destination_label newDestinationLabel,
              cr.change_fingerprint changeFingerprint, cr.status,
              vc.id caseId, vc.state caseState, vc.safe_case_code safeCaseCode,
              v.display_name vendorName
       FROM change_requests cr
       JOIN verification_cases vc ON vc.change_request_id = cr.id
       JOIN vendors v ON v.id = cr.vendor_id
       ORDER BY cr.requested_at DESC`,
    )
    .all()
    .map((r) => row(r));
}

export function insertCase(db: Db, c: VerificationCase): void {
  db.prepare(
    `INSERT INTO verification_cases
     (id, change_request_id, state, safe_case_code, current_intent_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(c.id, c.changeRequestId, c.state, c.safeCaseCode, c.currentIntentId, c.createdAt, c.updatedAt);
}

export function getCase(db: Db, id: string): VerificationCase | null {
  const r = db
    .prepare(
      `SELECT id, change_request_id changeRequestId, state, safe_case_code safeCaseCode,
              current_intent_id currentIntentId, created_at createdAt, updated_at updatedAt
       FROM verification_cases WHERE id = ?`,
    )
    .get(id);
  return r ? row<VerificationCase>(r) : null;
}

export function getCaseByRequestId(db: Db, changeRequestId: string): VerificationCase | null {
  const r = db
    .prepare(
      `SELECT id, change_request_id changeRequestId, state, safe_case_code safeCaseCode,
              current_intent_id currentIntentId, created_at createdAt, updated_at updatedAt
       FROM verification_cases WHERE change_request_id = ?`,
    )
    .get(changeRequestId);
  return r ? row<VerificationCase>(r) : null;
}

export function updateCaseState(db: Db, id: string, state: CaseState, currentIntentId?: string | null): void {
  db.prepare(
    `UPDATE verification_cases SET state = ?, updated_at = ?,
       current_intent_id = COALESCE(?, current_intent_id)
     WHERE id = ?`,
  ).run(state, now(), currentIntentId ?? null, id);
}

export function setPreviewExpiry(db: Db, caseId: string, expiresAt: string | null): void {
  db.prepare(
    "UPDATE verification_cases SET preview_expires_at = ?, updated_at = ? WHERE id = ?",
  ).run(expiresAt, now(), caseId);
}

export function getPreviewExpiry(db: Db, caseId: string): string | null {
  const r = db
    .prepare("SELECT preview_expires_at p FROM verification_cases WHERE id = ?")
    .get(caseId) as { p: string | null } | undefined;
  return r?.p ?? null;
}

export function insertIntent(db: Db, i: CallIntent): void {
  db.prepare(
    `INSERT INTO call_intents
     (id, case_id, version, trusted_contact_id, task_version, schema_version, task_text,
      request_hash, idempotency_key, destination_fingerprint, expires_at,
      operator_attestation, provider_call_id, provider_mode, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    i.id, i.caseId, i.version, i.trustedContactId, i.taskVersion, i.schemaVersion,
    i.taskText, i.requestHash, i.idempotencyKey, i.destinationFingerprint, i.expiresAt,
    i.operatorAttestation ? 1 : 0, i.providerCallId, i.providerMode, i.status, i.createdAt,
  );
}

export function getIntent(db: Db, id: string): CallIntent | null {
  const r = db
    .prepare(
      `SELECT id, case_id caseId, version, trusted_contact_id trustedContactId,
              task_version taskVersion, schema_version schemaVersion, task_text taskText,
              request_hash requestHash, idempotency_key idempotencyKey,
              destination_fingerprint destinationFingerprint, expires_at expiresAt,
              operator_attestation operatorAttestation, provider_call_id providerCallId,
              provider_mode providerMode, status, created_at createdAt
       FROM call_intents WHERE id = ?`,
    )
    .get(id) as (Omit<CallIntent, "operatorAttestation"> & { operatorAttestation: number }) | undefined;
  return r ? { ...r, operatorAttestation: r.operatorAttestation === 1 } : null;
}

export function getUnresolvedIntentForCase(db: Db, caseId: string): CallIntent | null {
  const r = db
    .prepare(
      `SELECT id FROM call_intents
       WHERE case_id = ? AND status IN ('reserved','dispatched')`,
    )
    .get(caseId);
  return r ? getIntent(db, (r as { id: string }).id) : null;
}

export function nextIntentVersion(db: Db, caseId: string): number {
  const r = db
    .prepare("SELECT COALESCE(MAX(version), 0) + 1 v FROM call_intents WHERE case_id = ?")
    .get(caseId) as { v: number };
  return r.v;
}

export function bindProviderCallId(db: Db, intentId: string, providerCallId: string): void {
  db.prepare(
    "UPDATE call_intents SET provider_call_id = ?, status = 'dispatched' WHERE id = ?",
  ).run(providerCallId, intentId);
}

export function insertSnapshot(db: Db, s: CallSnapshotRow): void {
  db.prepare(
    `INSERT INTO call_snapshots
     (id, intent_id, provider_call_id, provider_status, task_completed, recipient_status,
      confidence_score, structured_result_json, evidence_json, received_at, verification_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    s.id, s.intentId, s.providerCallId, s.providerStatus,
    s.taskCompleted === null ? null : s.taskCompleted ? 1 : 0,
    s.recipientStatus, s.confidenceScore, s.structuredResultJson, s.evidenceJson,
    s.receivedAt, s.verificationMode,
  );
}

export function getSnapshotsForIntent(db: Db, intentId: string): CallSnapshotRow[] {
  return db
    .prepare(
      `SELECT id, intent_id intentId, provider_call_id providerCallId, provider_status providerStatus,
              task_completed taskCompleted, recipient_status recipientStatus,
              confidence_score confidenceScore, structured_result_json structuredResultJson,
              evidence_json evidenceJson, received_at receivedAt, verification_mode verificationMode
       FROM call_snapshots WHERE intent_id = ? ORDER BY received_at`,
    )
    .all(intentId)
    .map((r) => {
      const s = r as Omit<CallSnapshotRow, "taskCompleted"> & { taskCompleted: number | null };
      return {
        ...s,
        taskCompleted: s.taskCompleted === null ? null : s.taskCompleted === 1,
      } satisfies CallSnapshotRow;
    });
}

const UNSAFE_AUDIT = /\+\d{7,15}|iams_(live|test)_|sk_live_/;

export function appendAudit(
  db: Db,
  input: { caseId: string; type: string; actor: string; payload: Record<string, unknown> },
): AuditEvent {
  const payloadJson = JSON.stringify(input.payload);
  if (UNSAFE_AUDIT.test(payloadJson)) {
    throw new Error("audit payload carries unsafe data");
  }
  const prev = db
    .prepare(
      "SELECT event_hash, created_at FROM audit_events WHERE case_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .get(input.caseId) as { event_hash: string; created_at: string } | undefined;
  const previousHash = prev?.event_hash ?? null;
  let createdAt = now();
  if (prev && createdAt <= prev.created_at) {
    createdAt = new Date(new Date(prev.created_at).getTime() + 1).toISOString();
  }
  const eventHash = createHash("sha256")
    .update(`${previousHash ?? "genesis"}|${input.caseId}|${input.type}|${input.actor}|${payloadJson}|${createdAt}`)
    .digest("hex");
  const event: AuditEvent = {
    id: newId("evt"),
    caseId: input.caseId,
    type: input.type,
    actor: input.actor,
    safePayloadJson: payloadJson,
    createdAt,
    previousHash,
    eventHash,
  };
  db.prepare(
    `INSERT INTO audit_events
     (id, case_id, type, actor, safe_payload_json, created_at, previous_hash, event_hash)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    event.id, event.caseId, event.type, event.actor, event.safePayloadJson,
    event.createdAt, event.previousHash, event.eventHash,
  );
  return event;
}

export function getAuditEvents(db: Db, caseId: string): AuditEvent[] {
  return db
    .prepare(
      `SELECT id, case_id caseId, type, actor, safe_payload_json safePayloadJson,
              created_at createdAt, previous_hash previousHash, event_hash eventHash
       FROM audit_events WHERE case_id = ? ORDER BY rowid`,
    )
    .all(caseId)
    .map((r) => row<AuditEvent>(r));
}
