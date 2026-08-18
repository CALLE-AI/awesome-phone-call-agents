/**
 * Caucus — shared contracts. FROZEN: every module builds against these types.
 * Changing anything here requires updating all owners (state, renderer, calle, engine).
 */

// ---------- Parties & disputes ----------

export type PartyId = "A" | "B";

export interface Party {
  id: PartyId;
  /** Display name used by the voice agent ("the landlord", "Alex from Sunrise LLC"). */
  label: string;
  /** E.164. Only ever dialed after recorded consent. */
  phone: string;
  /** Party-private context. MUST NEVER reach the other party's call. */
  private: PartyPrivate;
}

export interface PartyPrivate {
  /** Reservation bound in cents (A: minimum acceptable; B: maximum acceptable). */
  reservationCents?: number;
  /** Private rationale/notes captured during intake. Taint: never cross-party. */
  notes?: string;
}

export interface Dispute {
  /** e.g. "security_deposit", "unpaid_invoice", "freight_detention" — config, not code. */
  vertical: string;
  /** Neutral one-sentence description both parties agreed describes the dispute. */
  summary: string;
  /** Total amount in dispute, cents. Offers must be within [0, amountCents]. */
  amountCents: number;
  currency: "USD";
}

// ---------- Offers & rounds ----------

export type OfferKind = "open" | "counter" | "accept" | "reject" | "no_response";

export interface Offer {
  kind: OfferKind;
  /** Present for open/counter/accept. Cents. */
  amountCents?: number;
  /** Non-monetary conditions, verbatim from the call ("tenant returns garage remote"). */
  conditions: string[];
  /** Public rationale the party consented to convey ("carpet was damaged"). */
  publicRationale?: string;
  /** Supporting quote(s) from the call transcript/evidence[]. Provenance, never invented. */
  evidence: string[];
}

export interface Round {
  n: number;
  /** The party whose turn it was to receive the shuttle call this round. */
  callee: PartyId;
  callId?: string;
  offer?: Offer;
  outcome: CallOutcome;
  startedAt: string;
  completedAt?: string;
}

// ---------- Case state machine ----------

export type CaseState =
  | "created"
  | "consent_pending_a"
  | "consent_pending_b"
  | "rounds_active"
  | "attestation_pending_a"
  | "attestation_pending_b"
  | "settled"
  | "impasse"
  | "declined_consent"
  | "expired"
  | "cancelled";

export interface CaseRecord {
  caseId: string;
  state: CaseState;
  dispute: Dispute;
  parties: [Party, Party];
  rounds: Round[];
  /** Monotonic epoch; every accepted transition increments it. Idempotency backbone. */
  epoch: number;
  /** Terms both parties are attesting to (set when a round reaches accept). */
  settlement?: Settlement;
  policy: CasePolicy;
  createdAt: string;
  updatedAt: string;
}

export interface Settlement {
  amountCents: number;
  conditions: string[];
  /** SHA-256 of canonical terms JSON. */
  termsDigest: string;
  /** Phonetic attestation phrase derived from termsDigest. */
  attestationPhrase: string;
  attestations: Partial<Record<PartyId, Attestation>>;
}

export interface Attestation {
  callId: string;
  /** Verbatim phrase as captured from transcript/evidence. */
  spokenPhrase: string;
  verified: boolean;
  at: string;
}

export interface CasePolicy {
  maxRounds: number;
  /** Minutes between shuttle rounds (cooling-off). 0 in tests/demo. */
  coolingOffMinutes: number;
  /** Local quiet hours: no dialing outside [startHour, endHour) callee-local. */
  callWindow: { startHour: number; endHour: number; timezone: string };
  /** Retry ladder for no_answer, minutes after attempt. Empty = single attempt. */
  retryDelaysMinutes: number[];
  /** Case TTL in hours; expiry → "expired". */
  ttlHours: number;
}

// ---------- Call layer ----------

export type CallOutcome =
  | "completed"
  | "no_answer"
  | "declined"
  | "timed_out"
  | "failed"
  | "pending";

/** What the CALL-E integration returns to the state machine. Provider-agnostic. */
export interface CallResult {
  callId: string;
  outcome: CallOutcome;
  /** Schema-validated structured result, null when CALL-E could not produce one. */
  structured: Record<string, unknown> | null;
  confidence?: { score: number; label: string };
  evidence: string[];
  transcript: TranscriptTurn[];
  raw?: unknown;
}

export interface TranscriptTurn {
  offsetSeconds: number;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

/** A fully-rendered, taint-checked call request ready for the CALL-E client. */
export interface RenderedCall {
  caseId: string;
  round: number;
  callee: PartyId;
  phone: string;
  /** Natural-language task for CALL-E. MUST pass taint checks for the callee. */
  task: string;
  /** Strict-subset JSON schema for result extraction. */
  resultSchema: Record<string, unknown>;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CalleClient {
  /** Places (or simulates) a call and waits for the terminal result. */
  createAndWait(req: RenderedCall): Promise<CallResult>;
}

// ---------- Ledger ----------

export type LedgerEventType =
  | "case_created"
  | "consent_recorded"
  | "consent_declined"
  | "round_started"
  | "offer_recorded"
  | "round_failed"
  | "settlement_proposed"
  | "attestation_recorded"
  | "case_settled"
  | "case_impasse"
  | "case_cancelled"
  | "case_expired";

export interface LedgerEntry {
  seq: number;
  caseId: string;
  epoch: number;
  type: LedgerEventType;
  /** JSON payload (offer, consent details, attestation, ...). */
  payload: Record<string, unknown>;
  at: string;
  /** SHA-256 over (prevHash + canonical entry). Tamper-evidence chain. */
  hash: string;
  prevHash: string;
}

// ---------- Events driving the state machine ----------

export type CaseEvent =
  | { kind: "consent_result"; party: PartyId; result: CallResult }
  | { kind: "round_result"; round: number; result: CallResult }
  | { kind: "attestation_result"; party: PartyId; result: CallResult }
  | { kind: "cancel"; reason: string }
  | { kind: "tick"; now: string };

// ---------- Negotiation analytics ----------

export interface CurvePoint {
  round: number;
  party: PartyId;
  amountCents: number;
}

export interface EngineAssessment {
  /** Zone of possible agreement, when estimable from disclosed bounds. */
  zopa?: { lowCents: number; highCents: number };
  /** Detected stall/oscillation → recommend termination. */
  impasse: boolean;
  impasseReason?: string;
  /** Suggested neutral midpoint framing for the next shuttle call, if any. */
  nextSuggestionCents?: number;
  curve: CurvePoint[];
}
