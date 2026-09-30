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

// Narrow driver-agnostic statement/result shapes. Both @libsql/client (local
// file/memory, Docker) and @tursodatabase/serverless/compat (Turso remote)
// accept these; the remote driver is required because @libsql/client's
// SQL-over-HTTP path does not support concurrent writes on Turso.
export type DbArgs = (string | number | null)[];
export type DbStatement = string | { sql: string; args?: DbArgs };
export interface DbResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

// Db is the boundary every persistence function accepts: a database client or
// a transaction within one. Application code never sees the transport.
export interface Db {
  execute(stmt: DbStatement): Promise<DbResult>;
  batch(stmts: DbStatement[], mode?: "read" | "write" | "deferred"): Promise<DbBatchResult[]>;
}

// Batch statements are all writes here; only rowsAffected is consumed (the
// remote compat driver types batch rows wider than execute rows).
export interface DbBatchResult {
  rowsAffected: number;
}

export interface DbTransaction extends Db {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface DbClient extends Db {
  transaction(mode?: "write" | "read" | "deferred"): Promise<DbTransaction>;
  close(): void;
  readonly closed: boolean;
  protocol: string;
}

// Client selection only — no statements are executed against a remote client
// here (the serverless driver is lazy anyway), so callers may inspect the
// adapter without a network request. The Turso compat layer supports only
// { url, authToken }.
export async function createDbClient(path?: string): Promise<DbClient> {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  let client: DbClient;
  let remote = false;
  if (path !== undefined) {
    const { createClient } = await import("@libsql/client");
    client = createClient({ url: path === ":memory:" ? ":memory:" : fileUrl(path) });
  } else if (tursoUrl) {
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!authToken) {
      throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set");
    }
    const { createClient } = await import("@tursodatabase/serverless/compat");
    client = createClient({ url: tursoUrl, authToken });
    remote = true;
  } else {
    const { createClient } = await import("@libsql/client");
    client = createClient({
      url: fileUrl(process.env.CHANGELOCK_DB_PATH ?? "./data/changelock.db"),
    });
  }
  // libSQL enforces foreign keys per connection, so local file/memory
  // connections enable FK enforcement explicitly, plus a busy timeout to let
  // concurrent initializers serialize on the writer lock. The connected Turso
  // instance was probed and already reports foreign_keys=1, so no remote
  // PRAGMA is issued on every cold start.
  if (!remote) {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute("PRAGMA busy_timeout = 5000");
  }
  return client;
}

export async function openDatabase(path?: string): Promise<DbClient> {
  const client = await createDbClient(path);
  await migrate(client);
  return client;
}

function fileUrl(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return `file:${path}`;
}

// Single-statement list so migration runs identically on file, memory, and
// Turso remote connections (no multi-statement exec over HTTP).
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    vendor_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active','suspended'))
  )`,
  `CREATE TABLE IF NOT EXISTS trusted_contacts (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_active_contact_per_vendor
    ON trusted_contacts(vendor_id) WHERE active = 1`,
  `CREATE TABLE IF NOT EXISTS change_requests (
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
  )`,
  `CREATE TABLE IF NOT EXISTS verification_cases (
    id TEXT PRIMARY KEY,
    change_request_id TEXT NOT NULL UNIQUE REFERENCES change_requests(id),
    state TEXT NOT NULL,
    safe_case_code TEXT NOT NULL,
    current_intent_id TEXT,
    preview_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS call_intents (
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
  )`,
  `CREATE TABLE IF NOT EXISTS call_snapshots (
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
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES verification_cases(id),
    type TEXT NOT NULL,
    actor TEXT NOT NULL,
    safe_payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    previous_hash TEXT,
    event_hash TEXT NOT NULL UNIQUE
  )`,
];

// One atomic write batch: all-or-nothing DDL, and a single HTTP round trip on
// the remote serverless driver instead of one per statement.
export async function migrate(db: Db): Promise<void> {
  await db.batch(MIGRATIONS, "write");
}

// Atomic write scope: callers pass the client; inner operations receive the
// transaction. Nested calls are not supported — libSQL transactions do not
// expose a nested transaction API.
export async function withTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const maybeClient = db as DbClient;
  if (typeof maybeClient.transaction !== "function") {
    throw new Error("withTransaction requires a Client; nested transactions are not supported");
  }
  const tx = await maybeClient.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // already closed
    }
    throw err;
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

// External rows are narrowed field by field; a malformed row throws instead of
// being cast into the domain.
function fieldStr(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Error(`malformed row: ${field} is not a string`);
  return v;
}

function fieldStrOrNull(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  return fieldStr(v, field);
}

function fieldNum(v: unknown, field: string): number {
  if (typeof v !== "number") throw new Error(`malformed row: ${field} is not a number`);
  return v;
}

function fieldNumOrNull(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  return fieldNum(v, field);
}

function fieldLiteral<T extends string>(v: unknown, field: string, expected: T): T {
  const s = fieldStr(v, field);
  if (s !== expected) throw new Error(`malformed row: ${field} is not ${expected}`);
  return expected;
}

function fieldOneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  const s = fieldStr(v, field);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new Error(`malformed row: ${field} is not one of ${allowed.join(",")}`);
  }
  return s as T;
}

async function one(db: Db, sql: string, args: (string | number | null)[]): Promise<Record<string, unknown> | null> {
  const rs = await db.execute({ sql, args });
  return (rs.rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function all(db: Db, sql: string, args: (string | number | null)[] = []): Promise<Record<string, unknown>[]> {
  const rs = await db.execute({ sql, args });
  return rs.rows as unknown as Record<string, unknown>[];
}

const CASE_STATES: readonly CaseState[] = [
  "needs_review",
  "preview_ready",
  "dispatch_reserved",
  "submission_unknown",
  "call_active",
  "terminal_unverified",
  "verification_confirmed",
  "verification_denied",
  "needs_human",
];
const VENDOR_STATUSES: readonly Vendor["status"][] = ["active", "suspended"];
const REQUEST_STATUSES: readonly ChangeRequest["status"][] = ["held"];
const INTENT_STATUSES: readonly CallIntent["status"][] = [
  "reserved",
  "dispatched",
  "expired",
];
const PROVIDER_MODES: readonly CallIntent["providerMode"][] = ["replay", "live"];

const VENDOR_COLS = "id, display_name displayName, vendor_code vendorCode, status";

function toVendor(r: Record<string, unknown>): Vendor {
  return {
    id: fieldStr(r.id, "id"),
    displayName: fieldStr(r.displayName, "displayName"),
    vendorCode: fieldStr(r.vendorCode, "vendorCode"),
    status: fieldOneOf(r.status, "status", VENDOR_STATUSES),
  };
}

export async function getVendorByCode(db: Db, code: string): Promise<Vendor | null> {
  const r = await one(db, `SELECT ${VENDOR_COLS} FROM vendors WHERE vendor_code = ?`, [code]);
  return r ? toVendor(r) : null;
}

export async function getVendor(db: Db, id: string): Promise<Vendor | null> {
  const r = await one(db, `SELECT ${VENDOR_COLS} FROM vendors WHERE id = ?`, [id]);
  return r ? toVendor(r) : null;
}

export async function insertVendor(db: Db, v: Vendor): Promise<void> {
  await db.execute({
    sql: "INSERT INTO vendors (id, display_name, vendor_code, status) VALUES (?,?,?,?)",
    args: [v.id, v.displayName, v.vendorCode, v.status],
  });
}

// Idempotent seed-write statement: INSERT OR IGNORE is safe under concurrent
// initializers and repairs partially seeded databases by filling in only the
// missing rows.
export function insertVendorIfAbsentStmt(v: Vendor): DbStatement {
  return {
    sql: "INSERT OR IGNORE INTO vendors (id, display_name, vendor_code, status) VALUES (?,?,?,?)",
    args: [v.id, v.displayName, v.vendorCode, v.status],
  };
}

export function insertTrustedContactIfAbsentStmt(c: TrustedContact): DbStatement {
  return {
    sql: `INSERT OR IGNORE INTO trusted_contacts
     (id, vendor_id, name, role, phone_e164, region, locale, source, verified_at, active)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      c.id, c.vendorId, c.name, c.role, c.phoneE164, c.region, c.locale,
      c.source, c.verifiedAt, c.active ? 1 : 0,
    ],
  };
}

const CONTACT_COLS = `id, vendor_id vendorId, name, role, phone_e164 phoneE164, region, locale,
  source, verified_at verifiedAt, active`;

function toContact(r: Record<string, unknown>): TrustedContact {
  return {
    id: fieldStr(r.id, "id"),
    vendorId: fieldStr(r.vendorId, "vendorId"),
    name: fieldStr(r.name, "name"),
    role: fieldStr(r.role, "role"),
    phoneE164: fieldStr(r.phoneE164, "phoneE164"),
    region: fieldStr(r.region, "region"),
    locale: fieldStr(r.locale, "locale"),
    source: fieldLiteral(r.source, "source", "erp_vendor_master"),
    verifiedAt: fieldStr(r.verifiedAt, "verifiedAt"),
    active: fieldNum(r.active, "active") === 1,
  };
}

export async function getTrustedContact(db: Db, id: string): Promise<TrustedContact | null> {
  const r = await one(db, `SELECT ${CONTACT_COLS} FROM trusted_contacts WHERE id = ?`, [id]);
  return r ? toContact(r) : null;
}

export async function getActiveTrustedContact(db: Db, vendorId: string): Promise<TrustedContact | null> {
  const r = await one(
    db,
    `SELECT ${CONTACT_COLS} FROM trusted_contacts WHERE vendor_id = ? AND active = 1`,
    [vendorId],
  );
  return r ? toContact(r) : null;
}

const REQUEST_COLS = `id, external_event_id externalEventId, vendor_id vendorId, requested_at requestedAt,
  source_system sourceSystem, source_reference sourceReference,
  request_contact_name requestContactName,
  request_contact_phone_masked requestContactPhoneMasked,
  new_destination_label newDestinationLabel, change_fingerprint changeFingerprint, status`;

function toChangeRequest(r: Record<string, unknown>): ChangeRequest {
  return {
    id: fieldStr(r.id, "id"),
    externalEventId: fieldStr(r.externalEventId, "externalEventId"),
    vendorId: fieldStr(r.vendorId, "vendorId"),
    requestedAt: fieldStr(r.requestedAt, "requestedAt"),
    sourceSystem: fieldStr(r.sourceSystem, "sourceSystem"),
    sourceReference: fieldStr(r.sourceReference, "sourceReference"),
    requestContactName: fieldStr(r.requestContactName, "requestContactName"),
    requestContactPhoneMasked: fieldStr(r.requestContactPhoneMasked, "requestContactPhoneMasked"),
    newDestinationLabel: fieldStr(r.newDestinationLabel, "newDestinationLabel"),
    changeFingerprint: fieldStr(r.changeFingerprint, "changeFingerprint"),
    status: fieldOneOf(r.status, "status", REQUEST_STATUSES),
  };
}

// Cold-start-safe import write: one atomic write batch instead of an
// interactive transaction. Interactive write transactions across two local
// clients starve each other (the driver's busy-wait does not observe a peer
// client's commit promptly); a write batch is a single atomic unit that
// serializes correctly on both the local driver and Turso HTTP.
//
// Concurrency semantics: every statement is self-guarding, so two racing
// initializers can run the identical batch and the loser's batch no-ops —
//   request: INSERT OR IGNORE on unique external_event_id
//   case:    inserted only if this request has no case yet
//   audits:  inserted only if OUR case row exists (they key off the generated
//            case id, so a loser whose case insert was skipped writes nothing)
// Exactly one batch wins; the caller detects loss by re-reading the persisted
// request and comparing ids.
export async function insertImportBundle(
  db: Db,
  request: ChangeRequest,
  kase: VerificationCase,
  auditInputs: { type: string; actor: string; payload: Record<string, unknown> }[],
): Promise<void> {
  const stmts: DbStatement[] = [
    {
      sql: `INSERT OR IGNORE INTO change_requests
       (id, external_event_id, vendor_id, requested_at, source_system, source_reference,
        request_contact_name, request_contact_phone_masked, new_destination_label,
        change_fingerprint, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'held')`,
      args: [
        request.id, request.externalEventId, request.vendorId, request.requestedAt,
        request.sourceSystem, request.sourceReference, request.requestContactName,
        request.requestContactPhoneMasked, request.newDestinationLabel,
        request.changeFingerprint,
      ],
    },
    {
      sql: `INSERT INTO verification_cases
       (id, change_request_id, state, safe_case_code, current_intent_id, created_at, updated_at)
       SELECT ?, cr.id, ?, ?, NULL, ?, ?
       FROM change_requests cr
       WHERE cr.external_event_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM verification_cases vc WHERE vc.change_request_id = cr.id
         )`,
      args: [
        kase.id, kase.state, kase.safeCaseCode, kase.createdAt, kase.updatedAt,
        request.externalEventId,
      ],
    },
  ];
  let previousHash: string | null = null;
  let createdAt = now();
  for (const input of auditInputs) {
    const event = buildAuditEvent(kase.id, input, previousHash, createdAt);
    stmts.push({
      sql: `INSERT INTO audit_events
       (id, case_id, type, actor, safe_payload_json, created_at, previous_hash, event_hash)
       SELECT ?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM verification_cases WHERE id = ?)`,
      args: [
        event.id, event.caseId, event.type, event.actor, event.safePayloadJson,
        event.createdAt, event.previousHash, event.eventHash, kase.id,
      ],
    });
    previousHash = event.eventHash;
    createdAt = new Date(new Date(createdAt).getTime() + 1).toISOString();
  }
  await db.batch(stmts, "write");
}

export async function getChangeRequestByExternalEventId(
  db: Db,
  externalEventId: string,
): Promise<ChangeRequest | null> {
  const r = await one(db, `SELECT ${REQUEST_COLS} FROM change_requests WHERE external_event_id = ?`, [
    externalEventId,
  ]);
  return r ? toChangeRequest(r) : null;
}

export async function getChangeRequest(db: Db, id: string): Promise<ChangeRequest | null> {
  const r = await one(db, `SELECT ${REQUEST_COLS} FROM change_requests WHERE id = ?`, [id]);
  return r ? toChangeRequest(r) : null;
}

export interface InboxCaseRow extends ChangeRequest {
  caseId: string;
  caseState: CaseState;
  safeCaseCode: string;
  vendorName: string;
}

export async function listChangeRequests(db: Db): Promise<InboxCaseRow[]> {
  const rows = await all(
    db,
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
  );
  return rows.map((r) => ({
    ...toChangeRequest(r),
    caseId: fieldStr(r.caseId, "caseId"),
    caseState: fieldOneOf(r.caseState, "caseState", CASE_STATES),
    safeCaseCode: fieldStr(r.safeCaseCode, "safeCaseCode"),
    vendorName: fieldStr(r.vendorName, "vendorName"),
  }));
}

const CASE_COLS = `id, change_request_id changeRequestId, state, safe_case_code safeCaseCode,
  current_intent_id currentIntentId, created_at createdAt, updated_at updatedAt`;

function toCase(r: Record<string, unknown>): VerificationCase {
  return {
    id: fieldStr(r.id, "id"),
    changeRequestId: fieldStr(r.changeRequestId, "changeRequestId"),
    state: fieldOneOf(r.state, "state", CASE_STATES),
    safeCaseCode: fieldStr(r.safeCaseCode, "safeCaseCode"),
    currentIntentId: fieldStrOrNull(r.currentIntentId, "currentIntentId"),
    createdAt: fieldStr(r.createdAt, "createdAt"),
    updatedAt: fieldStr(r.updatedAt, "updatedAt"),
  };
}

export async function getCase(db: Db, id: string): Promise<VerificationCase | null> {
  const r = await one(db, `SELECT ${CASE_COLS} FROM verification_cases WHERE id = ?`, [id]);
  return r ? toCase(r) : null;
}

export async function getCaseByRequestId(
  db: Db,
  changeRequestId: string,
): Promise<VerificationCase | null> {
  const r = await one(db, `SELECT ${CASE_COLS} FROM verification_cases WHERE change_request_id = ?`, [
    changeRequestId,
  ]);
  return r ? toCase(r) : null;
}

export async function updateCaseState(
  db: Db,
  id: string,
  state: CaseState,
  currentIntentId?: string | null,
): Promise<void> {
  await db.execute({
    sql: `UPDATE verification_cases SET state = ?, updated_at = ?,
       current_intent_id = COALESCE(?, current_intent_id)
     WHERE id = ?`,
    args: [state, now(), currentIntentId ?? null, id],
  });
}

export async function setPreviewExpiry(
  db: Db,
  caseId: string,
  expiresAt: string | null,
): Promise<void> {
  await db.execute({
    sql: "UPDATE verification_cases SET preview_expires_at = ?, updated_at = ? WHERE id = ?",
    args: [expiresAt, now(), caseId],
  });
}

export async function getPreviewExpiry(db: Db, caseId: string): Promise<string | null> {
  const r = await one(db, "SELECT preview_expires_at p FROM verification_cases WHERE id = ?", [
    caseId,
  ]);
  return fieldStrOrNull(r?.p, "p");
}

const INTENT_COLS = `id, case_id caseId, version, trusted_contact_id trustedContactId,
  task_version taskVersion, schema_version schemaVersion, task_text taskText,
  request_hash requestHash, idempotency_key idempotencyKey,
  destination_fingerprint destinationFingerprint, expires_at expiresAt,
  operator_attestation operatorAttestation, provider_call_id providerCallId,
  provider_mode providerMode, status, created_at createdAt`;

function toIntent(r: Record<string, unknown>): CallIntent {
  return {
    id: fieldStr(r.id, "id"),
    caseId: fieldStr(r.caseId, "caseId"),
    version: fieldNum(r.version, "version"),
    trustedContactId: fieldStr(r.trustedContactId, "trustedContactId"),
    taskVersion: fieldStr(r.taskVersion, "taskVersion"),
    schemaVersion: fieldStr(r.schemaVersion, "schemaVersion"),
    taskText: fieldStr(r.taskText, "taskText"),
    requestHash: fieldStr(r.requestHash, "requestHash"),
    idempotencyKey: fieldStr(r.idempotencyKey, "idempotencyKey"),
    destinationFingerprint: fieldStr(r.destinationFingerprint, "destinationFingerprint"),
    expiresAt: fieldStr(r.expiresAt, "expiresAt"),
    operatorAttestation: fieldNum(r.operatorAttestation, "operatorAttestation") === 1,
    providerCallId: fieldStrOrNull(r.providerCallId, "providerCallId"),
    providerMode: fieldOneOf(r.providerMode, "providerMode", PROVIDER_MODES),
    status: fieldOneOf(r.status, "status", INTENT_STATUSES),
    createdAt: fieldStr(r.createdAt, "createdAt"),
  };
}

export async function insertIntent(db: Db, i: CallIntent): Promise<void> {
  await db.execute({
    sql: `INSERT INTO call_intents
     (id, case_id, version, trusted_contact_id, task_version, schema_version, task_text,
      request_hash, idempotency_key, destination_fingerprint, expires_at,
      operator_attestation, provider_call_id, provider_mode, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      i.id, i.caseId, i.version, i.trustedContactId, i.taskVersion, i.schemaVersion,
      i.taskText, i.requestHash, i.idempotencyKey, i.destinationFingerprint, i.expiresAt,
      i.operatorAttestation ? 1 : 0, i.providerCallId, i.providerMode, i.status, i.createdAt,
    ],
  });
}

export async function getIntent(db: Db, id: string): Promise<CallIntent | null> {
  const r = await one(db, `SELECT ${INTENT_COLS} FROM call_intents WHERE id = ?`, [id]);
  return r ? toIntent(r) : null;
}

export async function getIntentByProviderCallId(
  db: Db,
  providerCallId: string,
): Promise<CallIntent | null> {
  const r = await one(db, `SELECT ${INTENT_COLS} FROM call_intents WHERE provider_call_id = ?`, [
    providerCallId,
  ]);
  return r ? toIntent(r) : null;
}

export async function getIntentCaseId(db: Db, intentId: string): Promise<string | null> {
  const r = await one(db, "SELECT case_id caseId FROM call_intents WHERE id = ?", [intentId]);
  return fieldStrOrNull(r?.caseId, "caseId");
}

export async function listIntentsForCase(db: Db, caseId: string): Promise<CallIntent[]> {
  const rows = await all(
    db,
    `SELECT ${INTENT_COLS} FROM call_intents WHERE case_id = ? ORDER BY version`,
    [caseId],
  );
  return rows.map(toIntent);
}

export async function getUnresolvedIntentForCase(db: Db, caseId: string): Promise<CallIntent | null> {
  const rows = await all(
    db,
    `SELECT ${INTENT_COLS} FROM call_intents
     WHERE case_id = ? AND status IN ('reserved','dispatched')`,
    [caseId],
  );
  return rows.length > 0 ? toIntent(rows[0]) : null;
}

export async function nextIntentVersion(db: Db, caseId: string): Promise<number> {
  const r = await one(
    db,
    "SELECT COALESCE(MAX(version), 0) + 1 v FROM call_intents WHERE case_id = ?",
    [caseId],
  );
  return fieldNum(r?.v, "v");
}

export async function bindProviderCallId(
  db: Db,
  intentId: string,
  providerCallId: string,
): Promise<void> {
  await db.execute({
    sql: "UPDATE call_intents SET provider_call_id = ?, status = 'dispatched' WHERE id = ?",
    args: [providerCallId, intentId],
  });
}

export async function updateIntentStatus(
  db: Db,
  intentId: string,
  status: CallIntent["status"],
): Promise<void> {
  await db.execute({
    sql: "UPDATE call_intents SET status = ? WHERE id = ?",
    args: [status, intentId],
  });
}

export async function insertSnapshot(db: Db, s: CallSnapshotRow): Promise<void> {
  await db.execute({
    sql: `INSERT INTO call_snapshots
     (id, intent_id, provider_call_id, provider_status, task_completed, recipient_status,
      confidence_score, structured_result_json, evidence_json, received_at, verification_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      s.id, s.intentId, s.providerCallId, s.providerStatus,
      s.taskCompleted === null ? null : s.taskCompleted ? 1 : 0,
      s.recipientStatus, s.confidenceScore, s.structuredResultJson, s.evidenceJson,
      s.receivedAt, s.verificationMode,
    ],
  });
}

export async function getSnapshotsForIntent(db: Db, intentId: string): Promise<CallSnapshotRow[]> {
  const rows = await all(
    db,
    `SELECT id, intent_id intentId, provider_call_id providerCallId, provider_status providerStatus,
            task_completed taskCompleted, recipient_status recipientStatus,
            confidence_score confidenceScore, structured_result_json structuredResultJson,
            evidence_json evidenceJson, received_at receivedAt, verification_mode verificationMode
     FROM call_snapshots WHERE intent_id = ? ORDER BY received_at`,
    [intentId],
  );
  return rows.map((r) => {
    const t = fieldNumOrNull(r.taskCompleted, "taskCompleted");
    return {
      id: fieldStr(r.id, "id"),
      intentId: fieldStr(r.intentId, "intentId"),
      providerCallId: fieldStr(r.providerCallId, "providerCallId"),
      providerStatus: fieldStr(r.providerStatus, "providerStatus"),
      taskCompleted: t === null ? null : t === 1,
      recipientStatus: fieldStrOrNull(r.recipientStatus, "recipientStatus"),
      confidenceScore: fieldNumOrNull(r.confidenceScore, "confidenceScore"),
      structuredResultJson: fieldStrOrNull(r.structuredResultJson, "structuredResultJson"),
      evidenceJson: fieldStr(r.evidenceJson, "evidenceJson"),
      receivedAt: fieldStr(r.receivedAt, "receivedAt"),
      verificationMode: fieldOneOf(r.verificationMode, "verificationMode", PROVIDER_MODES),
    };
  });
}

// Demo-reset scope: only seeded synthetic cases may be cleared, and only the
// case's own call artifacts — never vendors, contacts, or the change request.
//
// One atomic write batch of self-guarding statements (the same concurrency
// pattern as insertImportBundle): interactive write transactions across two
// clients starve each other on the local driver (SQLITE_BUSY even after the
// peer commits) and cannot yield the required "second caller is rejected with
// the current state" semantics, so every statement guards on the case still
// being terminal:
//   deletes/reopen: fire only while state is a resettable terminal state
//   demo.reset:     fires only once the case has no audit rows — after this
//                   batch's own deletes for the winner, never for a loser
//                   whose batch runs after the winner already committed one
// Returns true when this batch performed the reset (its audit insert landed).
export async function resetCaseCallArtifacts(
  db: Db,
  caseId: string,
  auditInput: { type: string; actor: string; payload: Record<string, unknown> },
): Promise<boolean> {
  const terminal = `EXISTS (
    SELECT 1 FROM verification_cases vc
    WHERE vc.id = ? AND vc.state IN ('verification_confirmed','verification_denied','needs_human')
  )`;
  const event = buildAuditEvent(caseId, auditInput, null, now());
  const results = await db.batch(
    [
      {
        sql: `DELETE FROM call_snapshots
              WHERE intent_id IN (SELECT id FROM call_intents WHERE case_id = ?)
                AND ${terminal}`,
        args: [caseId, caseId],
      },
      {
        sql: `DELETE FROM call_intents WHERE case_id = ? AND ${terminal}`,
        args: [caseId, caseId],
      },
      {
        sql: `DELETE FROM audit_events WHERE case_id = ? AND ${terminal}`,
        args: [caseId, caseId],
      },
      {
        sql: `UPDATE verification_cases
              SET state = 'needs_review', current_intent_id = NULL,
                  preview_expires_at = NULL, updated_at = ?
              WHERE id = ?
                AND state IN ('verification_confirmed','verification_denied','needs_human')`,
        args: [now(), caseId],
      },
      {
        sql: `INSERT INTO audit_events
         (id, case_id, type, actor, safe_payload_json, created_at, previous_hash, event_hash)
         SELECT ?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (SELECT 1 FROM audit_events ae WHERE ae.case_id = ?)`,
        args: [
          event.id, event.caseId, event.type, event.actor, event.safePayloadJson,
          event.createdAt, event.previousHash, event.eventHash, caseId,
        ],
      },
    ],
    "write",
  );
  return results[4].rowsAffected === 1;
}

const UNSAFE_AUDIT = /\+\d{7,15}|iams_(live|test)_|sk_live_/;

function buildAuditEvent(
  caseId: string,
  input: { type: string; actor: string; payload: Record<string, unknown> },
  previousHash: string | null,
  createdAt: string,
): AuditEvent {
  const payloadJson = JSON.stringify(input.payload);
  if (UNSAFE_AUDIT.test(payloadJson)) {
    throw new Error("audit payload carries unsafe data");
  }
  const eventHash = createHash("sha256")
    .update(`${previousHash ?? "genesis"}|${caseId}|${input.type}|${input.actor}|${payloadJson}|${createdAt}`)
    .digest("hex");
  return {
    id: newId("evt"),
    caseId,
    type: input.type,
    actor: input.actor,
    safePayloadJson: payloadJson,
    createdAt,
    previousHash,
    eventHash,
  };
}

export async function appendAudit(
  db: Db,
  input: { caseId: string; type: string; actor: string; payload: Record<string, unknown> },
): Promise<AuditEvent> {
  const prev = await one(
    db,
    "SELECT event_hash, created_at FROM audit_events WHERE case_id = ? ORDER BY rowid DESC LIMIT 1",
    [input.caseId],
  );
  const previousHash = prev ? fieldStr(prev.event_hash, "event_hash") : null;
  let createdAt = now();
  if (prev && createdAt <= fieldStr(prev.created_at, "created_at")) {
    createdAt = new Date(new Date(fieldStr(prev.created_at, "created_at")).getTime() + 1).toISOString();
  }
  const event = buildAuditEvent(input.caseId, input, previousHash, createdAt);
  await db.execute({
    sql: `INSERT INTO audit_events
     (id, case_id, type, actor, safe_payload_json, created_at, previous_hash, event_hash)
     VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      event.id, event.caseId, event.type, event.actor, event.safePayloadJson,
      event.createdAt, event.previousHash, event.eventHash,
    ],
  });
  return event;
}

export async function getAuditEvents(db: Db, caseId: string): Promise<AuditEvent[]> {
  const rows = await all(
    db,
    `SELECT id, case_id caseId, type, actor, safe_payload_json safePayloadJson,
            created_at createdAt, previous_hash previousHash, event_hash eventHash
     FROM audit_events WHERE case_id = ? ORDER BY rowid`,
    [caseId],
  );
  return rows.map((r) => ({
    id: fieldStr(r.id, "id"),
    caseId: fieldStr(r.caseId, "caseId"),
    type: fieldStr(r.type, "type"),
    actor: fieldStr(r.actor, "actor"),
    safePayloadJson: fieldStr(r.safePayloadJson, "safePayloadJson"),
    createdAt: fieldStr(r.createdAt, "createdAt"),
    previousHash: fieldStrOrNull(r.previousHash, "previousHash"),
    eventHash: fieldStr(r.eventHash, "eventHash"),
  }));
}
