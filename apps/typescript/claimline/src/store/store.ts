import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assertTransition } from "../domain/states.js";
import type {
  CallIntent,
  CallResultRecord,
  CallStatus,
  CallType,
  Claim,
  ClaimContact,
  ClaimDecision,
  ClaimDecisionType,
  ContactRole,
  Customer,
  Disposition,
   HumanDecision,
  IntentState,
  Payment,
  Policy,
  PolicyStatus,
  PolicyType,
  TranscriptTurn,
} from "../domain/types.js";
import { openDatabase } from "./db.js";

export interface InboxEntry {
  eventId: string;
  callId: string;
  payload: string;
  receivedAt: string;
  processedAt: string | null;
}

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function boolToInt(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) !== 0;
}

/**
 * Durable application store. Owns claims, intents (with the state machine),
 * call results, the webhook inbox, and human decisions. Every consequential
 * transition is persisted so the workflow can be rebuilt after a crash.
 */
export class Store {
  constructor(private readonly db: DatabaseSync) {}

  static open(dbPath: string): Store {
    return new Store(openDatabase(dbPath));
  }

  close(): void {
    this.db.close();
  }

  // ---- Claims -------------------------------------------------------------

  createClaim(input: Omit<Claim, "id" | "createdAt">): Claim {
    const claim: Claim = { id: randomUUID(), createdAt: nowIso(), ...input };
    this.db
      .prepare(
        `INSERT INTO claims (id, reference, customer_id, policy_id, policyholder_name,
           claimant_phone, incident_type, region, locale, language, provider_name,
           provider_phone, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        claim.id,
        claim.reference,
        claim.customerId,
        claim.policyId,
        claim.policyholderName,
        claim.claimantPhone,
        claim.incidentType,
        claim.region,
        claim.locale,
        claim.language,
        claim.providerName,
        claim.providerPhone,
        claim.notes,
        claim.createdAt,
      );
    return claim;
  }

  listClaimsByCustomer(customerId: string): Claim[] {
    const rows = this.db
      .prepare(`SELECT * FROM claims WHERE customer_id = ? ORDER BY created_at DESC`)
      .all(customerId) as Row[];
    return rows.map(mapClaim);
  }

  getClaim(id: string): Claim | null {
    const row = this.db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? mapClaim(row) : null;
  }

  getClaimByReference(reference: string): Claim | null {
    const row = this.db
      .prepare(`SELECT * FROM claims WHERE reference = ?`)
      .get(reference) as Row | undefined;
    return row ? mapClaim(row) : null;
  }

  listClaims(): Claim[] {
    const rows = this.db
      .prepare(`SELECT * FROM claims ORDER BY created_at DESC`)
      .all() as Row[];
    return rows.map(mapClaim);
  }

  // ---- Intents ------------------------------------------------------------

  /**
   * Reserve an intent. Idempotent on the idempotency key: submitting the same
   * authorized intent again returns the existing row instead of creating a
   * duplicate, so a person is never dialed twice for one authorization.
   */
  reserveIntent(input: {
    claimId: string;
    contactId?: string | null;
    callType: CallType;
    idempotencyKey: string;
    destinationPhone: string;
    region: string;
    locale: string;
    schemaVersion: string;
    placedBy?: string | null;
  }): { intent: CallIntent; created: boolean } {
    const existing = this.getIntentByIdempotencyKey(input.idempotencyKey);
    if (existing) return { intent: existing, created: false };

    const now = nowIso();
    const intent: CallIntent = {
      id: randomUUID(),
      claimId: input.claimId,
      contactId: input.contactId ?? null,
      callType: input.callType,
      idempotencyKey: input.idempotencyKey,
      destinationPhone: input.destinationPhone,
      region: input.region,
      locale: input.locale,
      schemaVersion: input.schemaVersion,
      state: "reserved",
      placedBy: input.placedBy ?? null,
      reason: null,
      callId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO call_intents (id, claim_id, contact_id, call_type, idempotency_key,
           destination_phone, region, locale, schema_version, state, placed_by, reason, call_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        intent.id,
        intent.claimId,
        intent.contactId,
        intent.callType,
        intent.idempotencyKey,
        intent.destinationPhone,
        intent.region,
        intent.locale,
        intent.schemaVersion,
        intent.state,
        intent.placedBy,
        intent.reason,
        intent.callId,
        intent.createdAt,
        intent.updatedAt,
      );
    // Re-read to cover a race where another writer inserted the same key first.
    const stored = this.getIntentByIdempotencyKey(input.idempotencyKey);
    if (!stored) throw new Error("failed to reserve intent");
    return { intent: stored, created: stored.id === intent.id };
  }

  getIntent(id: string): CallIntent | null {
    const row = this.db
      .prepare(`SELECT * FROM call_intents WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? mapIntent(row) : null;
  }

  getIntentByIdempotencyKey(key: string): CallIntent | null {
    const row = this.db
      .prepare(`SELECT * FROM call_intents WHERE idempotency_key = ?`)
      .get(key) as Row | undefined;
    return row ? mapIntent(row) : null;
  }

  /** Count intents for a (claim, contact, type) — used to derive a re-dial nonce. */
  countIntentsForContact(
    claimId: string,
    contactId: string | null,
    callType: CallType,
  ): number {
    const row = contactId
      ? (this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM call_intents
             WHERE claim_id = ? AND contact_id = ? AND call_type = ?`,
          )
          .get(claimId, contactId, callType) as Row)
      : (this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM call_intents
             WHERE claim_id = ? AND contact_id IS NULL AND call_type = ?`,
          )
          .get(claimId, callType) as Row);
    return Number(row.n) || 0;
  }

  getIntentByCallId(callId: string): CallIntent | null {
    const row = this.db
      .prepare(`SELECT * FROM call_intents WHERE call_id = ?`)
      .get(callId) as Row | undefined;
    return row ? mapIntent(row) : null;
  }

  listIntents(): CallIntent[] {
    const rows = this.db
      .prepare(`SELECT * FROM call_intents ORDER BY created_at DESC`)
      .all() as Row[];
    return rows.map(mapIntent);
  }

  getIntentByContact(contactId: string): CallIntent | null {
    const row = this.db
      .prepare(
        `SELECT * FROM call_intents WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(contactId) as Row | undefined;
    return row ? mapIntent(row) : null;
  }

  listIntentsByClaim(claimId: string): CallIntent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM call_intents WHERE claim_id = ? ORDER BY created_at DESC`,
      )
      .all(claimId) as Row[];
    return rows.map(mapIntent);
  }

  listIntentsByStates(states: IntentState[]): CallIntent[] {
    if (states.length === 0) return [];
    const placeholders = states.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM call_intents WHERE state IN (${placeholders}) ORDER BY updated_at ASC`,
      )
      .all(...states) as Row[];
    return rows.map(mapIntent);
  }

  /**
   * Move an intent to a new state, enforcing the allowed transitions. Optional
   * `reason` and `callId` are persisted alongside the state change.
   */
  updateIntentState(
    id: string,
    toState: IntentState,
    opts?: { reason?: string | null; callId?: string | null },
  ): CallIntent {
    const current = this.getIntent(id);
    if (!current) throw new Error(`unknown intent: ${id}`);
    assertTransition(current.state, toState);
    const reason = opts?.reason !== undefined ? opts.reason : current.reason;
    const callId = opts?.callId !== undefined ? opts.callId : current.callId;
    this.db
      .prepare(
        `UPDATE call_intents SET state = ?, reason = ?, call_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(toState, reason, callId, nowIso(), id);
    const updated = this.getIntent(id);
    if (!updated) throw new Error(`intent vanished: ${id}`);
    return updated;
  }

  // ---- Results ------------------------------------------------------------

  saveResult(result: CallResultRecord): void {
    this.db
      .prepare(
        `INSERT INTO call_results (intent_id, call_id, status, task_completed,
           confidence_score, confidence_label, structured_result, evidence, summary,
           transcript, disposition, disposition_reason, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(intent_id) DO UPDATE SET
           call_id = excluded.call_id,
           status = excluded.status,
           task_completed = excluded.task_completed,
           confidence_score = excluded.confidence_score,
           confidence_label = excluded.confidence_label,
           structured_result = excluded.structured_result,
           evidence = excluded.evidence,
           summary = excluded.summary,
           transcript = excluded.transcript,
           disposition = excluded.disposition,
           disposition_reason = excluded.disposition_reason,
           received_at = excluded.received_at`,
      )
      .run(
        result.intentId,
        result.callId,
        result.status,
        boolToInt(result.taskCompleted),
        result.confidenceScore,
        result.confidenceLabel,
        result.structuredResult ? JSON.stringify(result.structuredResult) : null,
        JSON.stringify(result.evidence),
        result.summary,
        JSON.stringify(result.transcript),
        result.disposition,
        result.dispositionReason,
        result.receivedAt,
      );
  }

  getResult(intentId: string): CallResultRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM call_results WHERE intent_id = ?`)
      .get(intentId) as Row | undefined;
    return row ? mapResult(row) : null;
  }

  // ---- Claim contacts -----------------------------------------------------

  createContact(input: {
    claimId: string;
    role: ContactRole;
    name: string;
    phone: string;
    region?: string | null;
    locale?: string | null;
    note?: string | null;
  }): ClaimContact {
    const contact: ClaimContact = {
      id: randomUUID(),
      claimId: input.claimId,
      role: input.role,
      name: input.name,
      phone: input.phone,
      region: input.region ?? null,
      locale: input.locale ?? null,
      note: input.note ?? null,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO claim_contacts (id, claim_id, role, name, phone, region, locale, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        contact.id,
        contact.claimId,
        contact.role,
        contact.name,
        contact.phone,
        contact.region,
        contact.locale,
        contact.note,
        contact.createdAt,
      );
    return contact;
  }

  getContact(id: string): ClaimContact | null {
    const row = this.db
      .prepare(`SELECT * FROM claim_contacts WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? mapContact(row) : null;
  }

  listContactsByClaim(claimId: string): ClaimContact[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM claim_contacts WHERE claim_id = ? ORDER BY created_at ASC`,
      )
      .all(claimId) as Row[];
    return rows.map(mapContact);
  }

  // ---- Customers & policies ----------------------------------------------

  createCustomer(input: Omit<Customer, "id" | "createdAt">): Customer {
    const customer: Customer = { id: randomUUID(), createdAt: nowIso(), ...input };
    this.db
      .prepare(
        `INSERT INTO customers (id, name, phone, email, address, language, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        customer.id,
        customer.name,
        customer.phone,
        customer.email,
        customer.address,
        customer.language,
        customer.createdAt,
      );
    return customer;
  }

  getCustomer(id: string): Customer | null {
    const row = this.db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? mapCustomer(row) : null;
  }

  listCustomers(): Customer[] {
    const rows = this.db
      .prepare(`SELECT * FROM customers ORDER BY name ASC`)
      .all() as Row[];
    return rows.map(mapCustomer);
  }

  countCustomers(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as {
      n: number;
    };
    return Number(row.n);
  }

  createPolicy(input: Omit<Policy, "id" | "createdAt">): Policy {
    const policy: Policy = { id: randomUUID(), createdAt: nowIso(), ...input };
    this.db
      .prepare(
        `INSERT INTO policies (id, customer_id, policy_number, type, status, coverage_limit, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policy.id,
        policy.customerId,
        policy.policyNumber,
        policy.type,
        policy.status,
        policy.coverageLimit,
        policy.currency,
        policy.createdAt,
      );
    return policy;
  }

  getPolicy(id: string): Policy | null {
    const row = this.db
      .prepare(`SELECT * FROM policies WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? mapPolicy(row) : null;
  }

  getPolicyByNumber(policyNumber: string): Policy | null {
    const row = this.db
      .prepare(`SELECT * FROM policies WHERE policy_number = ?`)
      .get(policyNumber) as Row | undefined;
    return row ? mapPolicy(row) : null;
  }

  listPoliciesByCustomer(customerId: string): Policy[] {
    const rows = this.db
      .prepare(`SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at ASC`)
      .all(customerId) as Row[];
    return rows.map(mapPolicy);
  }

  // ---- Inbox (webhook dedupe) --------------------------------------------

  /** Insert a webhook delivery. Returns inserted=false for a duplicate event. */
  insertInboxEntry(input: {
    eventId: string;
    callId: string;
    payload: string;
  }): { inserted: boolean } {
    const result = this.db
      .prepare(
        `INSERT INTO inbox_entries (event_id, call_id, payload, received_at, processed_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .run(input.eventId, input.callId, input.payload, nowIso());
    return { inserted: Number(result.changes) > 0 };
  }

  listUnprocessedInbox(): InboxEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM inbox_entries WHERE processed_at IS NULL ORDER BY received_at ASC`,
      )
      .all() as Row[];
    return rows.map(mapInbox);
  }

  markInboxProcessed(eventId: string): void {
    this.db
      .prepare(`UPDATE inbox_entries SET processed_at = ? WHERE event_id = ?`)
      .run(nowIso(), eventId);
  }

  // ---- Human decisions ----------------------------------------------------

  saveDecision(decision: HumanDecision): void {
    this.db
      .prepare(
        `INSERT INTO human_decisions (intent_id, decided_by, decision, note, decided_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(intent_id) DO UPDATE SET
           decided_by = excluded.decided_by,
           decision = excluded.decision,
           note = excluded.note,
           decided_at = excluded.decided_at`,
      )
      .run(
        decision.intentId,
        decision.decidedBy,
        decision.decision,
        decision.note,
        decision.decidedAt,
      );
  }

  getDecision(intentId: string): HumanDecision | null {
    const row = this.db
      .prepare(`SELECT * FROM human_decisions WHERE intent_id = ?`)
      .get(intentId) as Row | undefined;
    return row ? mapDecision(row) : null;
  }

  // ---- Claim-level sanction decision --------------------------------------

  saveClaimDecision(decision: ClaimDecision): void {
    this.db
      .prepare(
        `INSERT INTO claim_decisions (claim_id, decided_by, decision, sanctioned_amount, currency, note, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(claim_id) DO UPDATE SET
           decided_by = excluded.decided_by,
           decision = excluded.decision,
           sanctioned_amount = excluded.sanctioned_amount,
           currency = excluded.currency,
           note = excluded.note,
           decided_at = excluded.decided_at`,
      )
      .run(
        decision.claimId,
        decision.decidedBy,
        decision.decision,
        decision.sanctionedAmount,
        decision.currency,
        decision.note,
        decision.decidedAt,
      );
  }

  getClaimDecision(claimId: string): ClaimDecision | null {
    const row = this.db
      .prepare(`SELECT * FROM claim_decisions WHERE claim_id = ?`)
      .get(claimId) as Row | undefined;
    return row ? mapClaimDecision(row) : null;
  }

  // ---- Payments -----------------------------------------------------------

  savePayment(payment: Payment): void {
    this.db
      .prepare(
        `INSERT INTO payments (id, claim_id, amount, currency, status, provider, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payment.id,
        payment.claimId,
        payment.amount,
        payment.currency,
        payment.status,
        payment.provider,
        payment.reference,
        payment.createdAt,
      );
  }

  getLatestPaymentByClaim(claimId: string): Payment | null {
    const row = this.db
      .prepare(
        `SELECT * FROM payments WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(claimId) as Row | undefined;
    return row ? mapPayment(row) : null;
  }

  // ---- Autopilot flags ----------------------------------------------------

  setClaimAutopilot(claimId: string, on: boolean): void {
    this.db
      .prepare(`UPDATE claims SET autopilot = ? WHERE id = ?`)
      .run(on ? 1 : 0, claimId);
  }

  markClaimReportSent(claimId: string, at: string): void {
    this.db.prepare(`UPDATE claims SET report_sent_at = ? WHERE id = ?`).run(at, claimId);
  }

  getClaimAutopilot(claimId: string): {
    autopilot: boolean;
    reportSentAt: string | null;
  } {
    const row = this.db
      .prepare(`SELECT autopilot, report_sent_at FROM claims WHERE id = ?`)
      .get(claimId) as Row | undefined;
    return {
      autopilot: !!(row && Number(row.autopilot)),
      reportSentAt: (row?.report_sent_at as string | null) ?? null,
    };
  }

  listAutopilotPendingClaimIds(): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM claims WHERE autopilot = 1 AND report_sent_at IS NULL`)
      .all() as Row[];
    return rows.map((r) => String(r.id));
  }
}

// ---- Row mappers ----------------------------------------------------------

function mapClaim(row: Row): Claim {
  return {
    id: String(row.id),
    reference: String(row.reference),
    customerId: (row.customer_id as string | null) ?? null,
    policyId: (row.policy_id as string | null) ?? null,
    policyholderName: String(row.policyholder_name),
    claimantPhone: String(row.claimant_phone),
    incidentType: String(row.incident_type),
    region: String(row.region),
    locale: String(row.locale),
    language: (row.language as string | null) ?? null,
    providerName: (row.provider_name as string | null) ?? null,
    providerPhone: (row.provider_phone as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapPayment(row: Row): Payment {
  return {
    id: String(row.id),
    claimId: String(row.claim_id),
    amount: Number(row.amount),
    currency: String(row.currency),
    status: String(row.status) as Payment["status"],
    provider: String(row.provider),
    reference: String(row.reference),
    createdAt: String(row.created_at),
  };
}

function mapCustomer(row: Row): Customer {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    email: (row.email as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapPolicy(row: Row): Policy {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    policyNumber: String(row.policy_number),
    type: String(row.type) as PolicyType,
    status: String(row.status) as PolicyStatus,
    coverageLimit: (row.coverage_limit as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapIntent(row: Row): CallIntent {
  return {
    id: String(row.id),
    claimId: String(row.claim_id),
    contactId: (row.contact_id as string | null) ?? null,
    callType: String(row.call_type) as CallType,
    idempotencyKey: String(row.idempotency_key),
    destinationPhone: String(row.destination_phone),
    region: String(row.region),
    locale: String(row.locale),
    schemaVersion: String(row.schema_version),
    state: String(row.state) as IntentState,
    placedBy: (row.placed_by as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    callId: (row.call_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapContact(row: Row): ClaimContact {
  return {
    id: String(row.id),
    claimId: String(row.claim_id),
    role: String(row.role) as ContactRole,
    name: String(row.name),
    phone: String(row.phone),
    region: (row.region as string | null) ?? null,
    locale: (row.locale as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapClaimDecision(row: Row): ClaimDecision {
  return {
    claimId: String(row.claim_id),
    decidedBy: String(row.decided_by),
    decision: String(row.decision) as ClaimDecisionType,
    sanctionedAmount: (row.sanctioned_amount as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    decidedAt: String(row.decided_at),
  };
}

function mapResult(row: Row): CallResultRecord {
  return {
    intentId: String(row.intent_id),
    callId: String(row.call_id),
    status: String(row.status) as CallStatus,
    taskCompleted: intToBool(row.task_completed),
    confidenceScore: (row.confidence_score as number | null) ?? null,
    confidenceLabel: (row.confidence_label as string | null) ?? null,
    structuredResult: row.structured_result
      ? (JSON.parse(String(row.structured_result)) as Record<string, unknown>)
      : null,
    evidence: row.evidence ? (JSON.parse(String(row.evidence)) as string[]) : [],
    summary: (row.summary as string | null) ?? null,
    transcript: row.transcript
      ? (JSON.parse(String(row.transcript)) as TranscriptTurn[])
      : [],
    disposition: String(row.disposition) as Disposition,
    dispositionReason: String(row.disposition_reason),
    receivedAt: String(row.received_at),
  };
}

function mapInbox(row: Row): InboxEntry {
  return {
    eventId: String(row.event_id),
    callId: String(row.call_id),
    payload: String(row.payload),
    receivedAt: String(row.received_at),
    processedAt: (row.processed_at as string | null) ?? null,
  };
}

function mapDecision(row: Row): HumanDecision {
  return {
    intentId: String(row.intent_id),
    decidedBy: String(row.decided_by),
    decision: String(row.decision),
    note: (row.note as string | null) ?? null,
    decidedAt: String(row.decided_at),
  };
}
