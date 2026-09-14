/**
 * Core ClaimLine domain types.
 *
 * The application owns business intent, authorization, idempotency, state
 * transitions, and audit history. CALL-E only executes and reports calls.
 * These types deliberately keep application state SEPARATE from CALL-E's call
 * lifecycle status (see `IntentState` vs `CallStatus`).
 */

/** CALL-E call lifecycle status (mirrors the SDK `CallStatus`). */
export type CallStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

/**
 * The phone workflows ClaimLine runs. Each call type has a role-specific script
 * and result schema. fnol_intake + status_chase are the original two; the
 * medical/bill types support multi-party claim investigation.
 */
export type CallType =
  | "fnol_intake"
  | "status_chase"
  | "medical_report"
  | "bill_verification";

/** A party associated with a claim that ClaimLine may call. */
export type ContactRole =
  | "claimant"
  | "treating_doctor"
  | "hospital_billing"
  | "repair_shop"
  | "witness"
  | "other";

/**
 * Application-owned intent state machine. These names describe what the
 * workflow KNOWS, and never collapse into CALL-E's call statuses.
 */
export type IntentState =
  | "reserved" // intent + stable idempotency key persisted; nothing submitted
  | "submission_unknown" // request left the client; acceptance unknown -> reconcile
  | "accepted" // authoritative call id stored and bound to the intent
  | "terminal_unverified" // a read/webhook suggests terminal, checks incomplete
  | "terminal_verified" // terminal snapshot matches intent and passes policy
  | "needs_human" // ambiguous/contradictory/failed -> stop automation
  | "applied" // a human-owned business decision was recorded
  | "canceled"; // canceled before dial

/** Fail-closed disposition for a completed call result. */
export type Disposition = "auto_ok" | "needs_human";

export interface TranscriptTurn {
  offsetSeconds: number | null;
  speaker: string;
  text: string;
}

export interface Customer {
  id: string;
  name: string;
  /** Full E.164 number. Access-controlled; masked in previews/logs. */
  phone: string;
  email: string | null;
  address: string | null;
  /** Preferred call language code (en/hi/es). */
  language: string | null;
  createdAt: string;
}

export type PolicyType = "auto" | "health" | "home" | "travel";
export type PolicyStatus = "active" | "lapsed";

export interface Policy {
  id: string;
  customerId: string;
  policyNumber: string;
  type: PolicyType;
  status: PolicyStatus;
  coverageLimit: number | null;
  currency: string | null;
  createdAt: string;
}

export interface Claim {
  id: string;
  reference: string;
  /** Owning customer + policy (null for legacy standalone claims). */
  customerId: string | null;
  policyId: string | null;
  policyholderName: string;
  /** Full E.164 claimant number. Access-controlled; never logged unmasked. */
  claimantPhone: string;
  incidentType: string;
  region: string;
  locale: string;
  /** Preferred call language code (en/hi/es). */
  language: string | null;
  /** Optional third party for status-chase calls (repair shop, clinic, ...). */
  providerName: string | null;
  /** Full E.164 provider number. Access-controlled; never logged unmasked. */
  providerPhone: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CallIntent {
  id: string;
  claimId: string;
  /** The associated contact this call is for (null for legacy claim-level calls). */
  contactId: string | null;
  callType: CallType;
  /** Stable key derived from the authorized intent, not from an attempt. */
  idempotencyKey: string;
  /** Full E.164 destination. Access-controlled; masked in all previews/logs. */
  destinationPhone: string;
  region: string;
  locale: string;
  schemaVersion: string;
  state: IntentState;
  /** Which actor placed the call: owner / guest / fixture (for reconciliation). */
  placedBy: string | null;
  /** Why the intent is in needs_human / canceled, when applicable. */
  reason: string | null;
  /** CALL-E call id once the call is accepted. */
  callId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A party associated with a claim (claimant, doctor, hospital billing, ...). */
export interface ClaimContact {
  id: string;
  claimId: string;
  role: ContactRole;
  name: string;
  /** Full E.164 number. Access-controlled; masked in all previews/logs. */
  phone: string;
  /** Optional per-contact CALL-E region/locale override (else the claim's). */
  region: string | null;
  locale: string | null;
  note: string | null;
  createdAt: string;
}

export interface CallResultRecord {
  intentId: string;
  callId: string;
  status: CallStatus;
  taskCompleted: boolean | null;
  confidenceScore: number | null;
  confidenceLabel: string | null;
  structuredResult: Record<string, unknown> | null;
  evidence: string[];
  summary: string | null;
  transcript: TranscriptTurn[];
  disposition: Disposition;
  dispositionReason: string;
  receivedAt: string;
}

/** Human decision recorded after review. ClaimLine never auto-applies these. */
export interface HumanDecision {
  intentId: string;
  decidedBy: string;
  decision: string;
  note: string | null;
  decidedAt: string;
}

/** Claim-level outcome the human sanctions after reviewing the whole case. */
export type ClaimDecisionType = "approved" | "rejected" | "hold";

export interface ClaimDecision {
  claimId: string;
  decidedBy: string;
  decision: ClaimDecisionType;
  /** Sanctioned amount (for approvals). */
  sanctionedAmount: number | null;
  currency: string | null;
  note: string | null;
  decidedAt: string;
}

export type PaymentStatus = "succeeded" | "failed" | "pending";

/** A payout attempt for an approved claim (Stripe or simulated). */
export interface Payment {
  id: string;
  claimId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  /** "stripe" | "simulated" */
  provider: string;
  /** Provider reference (Stripe PaymentIntent id, or a simulated id). */
  reference: string;
  createdAt: string;
}

