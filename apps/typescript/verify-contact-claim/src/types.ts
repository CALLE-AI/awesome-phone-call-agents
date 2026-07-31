/**
 * Shared types for the contact-claim verifier.
 *
 * CALL-E snapshot types are declared locally, so preview and record verification
 * run with no SDK installed. They match what `@call-e/calle` returns: camelCase
 * fields on the call, the recipient and the attempt plus API-shaped transcript
 * turns.
 *
 * Anything that reaches a record or the JSON output uses snake_case, so a record
 * reads back into the same shapes it was written from.
 */

/** How the contact being checked arrived. A live call in progress is out of scope. */
export type ContactChannel = "voicemail" | "text_message" | "missed_call" | "answered_call";

/**
 * The five answers this app gives. Nothing else is ever reported.
 *
 * `refused_to_confirm` is a real answer rather than a failure. An institution that
 * will not discuss a third party's account has told the customer nothing about the
 * contact, so the app still hands back the number on their card.
 */
export type Outcome =
  | "confirmed_genuine"
  | "no_such_contact"
  | "refused_to_confirm"
  | "unreachable"
  | "outcome_unknown";

/** Why an outcome is not one of the three answers. Null on an answered call. */
export type Reason =
  /** Terminal call that never reached a person. */
  | "no_answer"
  | "machine_answered"
  | "call_failed"
  | "nobody_spoke"
  | "ended_before_question"
  /** The call happened and nothing in it answers the question. */
  | "no_supporting_turn"
  | "low_confidence"
  | "corroboration_disagrees"
  /** The call exists and its result could not be read. */
  | "call_not_finished"
  | "call_not_read"
  | "call_state_unknown"
  | "completion_time_unknown"
  | "answered_outside_window"
  /** CALL-E refused the create, so no call was placed. */
  | "api_error";

/** What the callee turns after our question say about the contact. */
export type ContactSignal = "confirmed" | "denied" | "refused" | "unclear";

export interface ClaimContact {
  /** Who the message said it was. Spoken on the call. */
  claimed_to_be: string;
  channel: ContactChannel;
  /** When it arrived, ISO 8601 with an offset. Spoken on the call. */
  arrived_at: string;
  /** The subject, in a few neutral words. Spoken on the call. */
  claimed_about: string;
  /** The number that showed up. Never dialled. */
  number_shown: string;
  /**
   * What the caller wanted the customer to do. Never spoken, never sent to
   * CALL-E. It is here so the customer has it written down and so the preview can
   * show what this app is refusing to repeat.
   */
  asked_for: string;
}

export interface TrustedNumber {
  /** The only number this app dials. */
  phone: string;
  /** Where the customer read it. The trust anchor is the card in their hand. */
  printed_on: string;
  region?: string;
}

export interface PolicyInput {
  per_call_timeout_seconds?: number;
  recent_window_minutes?: number;
  language?: string;
  min_confidence?: number;
}

export interface Policy {
  perCallTimeoutSeconds: number;
  /** The window the question asks about. Spoken on the call. */
  recentWindowMinutes: number;
  language: string;
  minConfidence: number;
}

/** Shape of the claim file on disk. */
export interface ClaimInput {
  claim_id: string;
  customer: { name: string; callback_number?: string };
  contact: ClaimContact;
  trusted_number: TrustedNumber;
  policy?: PolicyInput;
}

/** Validated claim with policy defaults resolved. */
export interface Claim {
  claimId: string;
  /**
   * The person the call is made for. `callback_number` is their own number, given
   * out on the call so the institution can reach a responsible party rather than
   * the machine that dialled them.
   */
  customer: { name: string; callback_number?: string };
  contact: ClaimContact;
  trustedNumber: TrustedNumber;
  policy: Policy;
}

/** Something in the claim file that stops the call. */
export interface ScanFinding {
  /** The field it was found in, by path, so the customer can go and remove it. */
  field: string;
  kind: string;
  /** Masked on purpose. A refusal that quotes the secret has published it. */
  masked: string;
}

export interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
}

export interface CallRecipientInput {
  phones: string[];
  region?: string;
  locale?: string;
}

/** Exactly what gets sent to CALL-E. Built in one place so it can be hashed. */
export interface CreateCallInput {
  task: string;
  recipients: CallRecipientInput[];
  resultSchema: JsonSchema;
  metadata: Record<string, string | number>;
}

export interface TranscriptTurn {
  offset_seconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export interface CallAttemptSnapshot {
  id: string;
  phone: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  transcriptTurns: TranscriptTurn[];
  providerCallId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CallRecipientSnapshot {
  id: string;
  phones: string[];
  status: string;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  attempts: CallAttemptSnapshot[];
}

export interface Confidence {
  score: number;
  label: string;
}

export interface CallSnapshot {
  id: string;
  status: string;
  recipients: CallRecipientSnapshot[];
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: Confidence | null;
  evidence: string[];
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** What the local transcript reader found in the callee turns. */
export interface TranscriptReading {
  calleeTurnCount: number;
  machineAnswered: boolean;
  /** True when a caller turn actually asked our question. */
  questionAsked: boolean;
  signal: ContactSignal;
  /** The callee turn the signal came from, verbatim. Empty when there is none. */
  supportingTurn: string;
  /** Every callee turn after the question, verbatim, up to the answer window. */
  excerpt: string[];
}

/**
 * Every input the outcome depends on.
 *
 * It is stored verbatim in the record, so the recorded outcome can be recomputed
 * later from the same inputs by the same function. A record whose outcome was
 * edited by hand fails verification even when its hash chain is intact.
 */
export interface OutcomeInputs {
  /** The provider status, or `api_error` when nothing was placed, or `state_unknown`. */
  call_status: string;
  failure_code: string | null;
  transcript_available: boolean;
  reached_person: boolean;
  machine_answered: boolean;
  question_asked: boolean;
  signal: ContactSignal;
  /** CALL-E's own reading. Corroboration only, and null on a healthy call. */
  structured_signal: ContactSignal | null;
  /** False when the call reported no completion time this app could use. */
  completion_time_usable: boolean;
  /** False when the answer landed outside the window this run opened. */
  answered_in_window: boolean;
  confidence: Confidence | null;
}

/** The claim as it is stored in a record. Numbers are masked or digested. */
export interface RecordedClaim {
  claimed_to_be: string;
  channel: ContactChannel;
  arrived_at: string;
  claimed_about: string;
  recent_window_minutes: number;
  number_shown_masked: string;
  number_shown_digest: string;
  trusted_number_masked: string;
  trusted_number_digest: string;
  trusted_printed_on: string;
  /** The number given out on the call for the responsible party, or null when none was. */
  callback_number_masked: string | null;
}

export interface CheckResult {
  claim_id: string;
  outcome: Outcome;
  reason: Reason | null;
  /** The question as it was put on the call, word for word. */
  question: string;
  /** What the person on the line said, verbatim. Empty when nobody answered it. */
  callee_quote: string;
  /** The number that was dialled, masked. It is always the trusted one. */
  dialled_masked: string;
  /** The number the customer should use, with where they read it. */
  use_number: string;
  use_number_printed_on: string;
  what_to_do: string;
  evidence: OutcomeInputs;
  transcript_excerpt: string[];
  transcript: TranscriptTurn[];
  /** CALL-E's own note, printed with its name on it. Never treated as evidence. */
  callee_note: string;
  call_id: string | null;
  provider_call_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  record_hash: string | null;
}

export interface ClaimRecord {
  seq: number;
  recorded_at: string;
  claim_id: string;
  claim_digest: string;
  claim: RecordedClaim;
  question: string;
  outcome: Outcome;
  reason: Reason | null;
  callee_quote: string;
  transcript_excerpt: string[];
  evidence: OutcomeInputs;
  /** Digest of the number this run actually dialled. Verification re-checks it. */
  dialled_digest: string;
  dialled_masked: string;
  min_confidence: number;
  call_id: string | null;
  provider_call_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  prev_hash: string;
  hash: string;
}

export interface RecordIssue {
  seq: number;
  problem: string;
}

export interface RecordVerification {
  ok: boolean;
  records: number;
  issues: RecordIssue[];
}
