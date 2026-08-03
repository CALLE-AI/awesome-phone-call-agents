/**
 * Shared types for the multi-party scheduler.
 *
 * CALL-E snapshot types are declared locally so `plan` and `replay` run with no
 * SDK installed. They match what `@call-e/calle` returns: camelCase on the call,
 * recipient and attempt and API-shaped transcript turns.
 *
 * Anything that reaches the ledger or the JSON output uses snake_case, so a
 * ledger line reads back into the same shapes it was written from.
 */

export type Phase = "gather" | "confirm" | "release";

/**
 * `verbally_confirmed` is the best this app can claim. Every party said yes on a
 * call and that is all: no calendar, no booking system, nothing reserved
 * anywhere. Calling it `booked` would say a record exists that does not.
 */
export type Outcome =
  | "verbally_confirmed"
  | "no_common_slot"
  | "not_confirmed"
  | "window_expired"
  | "budget_exhausted"
  | "not_reached"
  | "canceled"
  | "unresolved"
  | "api_error";

export interface SlotInput {
  id: string;
  /** Full ISO 8601 with an offset, for example 2026-08-06T10:00:00-07:00. */
  start: string;
}

export interface Slot {
  id: string;
  /** 1 based option number, which is what people say back on a call. */
  option: number;
  start: string;
  startMs: number;
  /** How the caller reads this option out loud. */
  spoken: string;
}

export interface CallingHoursInput {
  /** Local wall clock, 24 hour HH:MM. */
  start: string;
  end: string;
  /** IANA name. Falls back to the meeting timezone when the party omits it. */
  timezone?: string;
}

export interface CallingHours {
  start: string;
  end: string;
  timezone: string;
  startMinutes: number;
  endMinutes: number;
}

export interface PartyInput {
  id: string;
  name: string;
  phone: string;
  role: string;
  region?: string;
  locale?: string;
  /** Must be true. Nobody is dialled on an unrecorded consent. */
  consent_recorded?: boolean;
  calling_hours?: CallingHoursInput;
}

export interface Party {
  id: string;
  name: string;
  phone: string;
  role: string;
  region?: string;
  locale?: string;
  consentRecorded: boolean;
  callingHours: CallingHours;
}

export interface MeetingInput {
  purpose: string;
  location: string;
  /** IANA name, for example America/Los_Angeles. Never inferred. */
  timezone: string;
  organizer: string;
  duration_minutes: number;
}

export interface PolicyInput {
  window_minutes?: number;
  per_call_timeout_seconds?: number;
  max_calls?: number;
  min_confidence?: number;
}

export interface Policy {
  windowMinutes: number;
  perCallTimeoutSeconds: number;
  maxCalls: number;
  minConfidence: number;
}

export interface CoordinationRequestInput {
  request_id: string;
  meeting: MeetingInput;
  slots: SlotInput[];
  parties: PartyInput[];
  policy?: PolicyInput;
}

export interface CoordinationRequest {
  requestId: string;
  meeting: MeetingInput;
  slots: Slot[];
  parties: Party[];
  policy: Policy;
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

/** What one gather call established for one party. */
export interface GatherResult {
  party_id: string;
  phone_masked: string;
  call_id: string | null;
  provider_call_id: string | null;
  /**
   * The `Idempotency-Key` this call was created under. Recorded because it is the
   * only handle on a create whose response was lost and because recovery
   * re-issues this exact string rather than rebuilding one. Null when no call was
   * attempted at all.
   */
  idempotency_key: string | null;
  call_status: string;
  reached_person: boolean;
  machine_answered: boolean;
  /** Options the extracted result reported as workable. */
  structured_options: number[];
  /** Options the transcript reader also heard. */
  heard_options: number[];
  /** What the party is credited with: the agreement of both sources. */
  available_options: number[];
  none_work: boolean;
  disagreement: boolean;
  confidence: Confidence | null;
  notes: string;
  transcript_excerpt: string[];
  failure_code: string | null;
}

/**
 * Why a window check refused an answer.
 *
 * `completion_time_unknown` means CALL-E gave no completion time this app could
 * read, which is checked before either clock so a record can never claim the
 * window was checked against a time nobody could read. `no_window` means the
 * window itself could not be computed, `late_result` that the local clock was
 * past the deadline when the answer came back and `outside_window` that the
 * completion time sat outside this run.
 */
export type WindowRefusal =
  | "completion_time_unknown"
  | "no_window"
  | "late_result"
  | "outside_window";

/** What one confirm or release call established for one party. */
export interface CommitResult {
  party_id: string;
  phone_masked: string;
  phase: Phase;
  slot_id: string;
  call_id: string | null;
  provider_call_id: string | null;
  /**
   * The `Idempotency-Key` this call was created under. `resume` re-issues this
   * exact string to settle a call, so the key is durable state rather than
   * something recomputed from the request and the code in hand. Null when no
   * call was attempted at all.
   */
  idempotency_key: string | null;
  call_status: string;
  confirmed: boolean;
  declined: boolean;
  acknowledged: boolean;
  /**
   * Confirm calls only: did the answer land inside the window this round could
   * still act on. A late final response cannot confirm anything. A release call
   * is not governed by the window, so it records true.
   */
  within_window: boolean;
  /**
   * Which check refused the answer, so a ledger line says why rather than
   * looking like a plain expired window. Null when it landed in time and on a
   * release call, which the window does not govern.
   */
  window_reason: WindowRefusal | null;
  /**
   * Whether CALL-E gave a completion time this app could read. False means the
   * window was never weighed against a real instant, which is why the answer was
   * refused rather than trusted.
   */
  completion_time_usable: boolean;
  /** Confirm calls only: did the call actually ask the confirmation question. */
  question_asked: boolean;
  reached_person: boolean;
  machine_answered: boolean;
  structured_answer: string | null;
  heard_answer: string | null;
  disagreement: boolean;
  confidence: Confidence | null;
  transcript_excerpt: string[];
  failure_code: string | null;
}

/**
 * One line per event.
 *
 * `call_attempt` and `call_accepted` are written by `placeCall` itself rather than
 * by its caller: the first before the create, the second as soon as CALL-E hands
 * back an id and before anything waits on the call. A process that dies in that
 * window used to leave nothing at all, so the call was at CALL-E and no record of
 * it was on disk. Neither entry holds an answer and neither counts as a call
 * placed: the phase entry that follows is still the only thing that says what a
 * call did.
 */
export type LedgerEntry =
  | { kind: "run_started"; at: string; request_id: string; request_digest: string; slots: Slot[]; parties: string[]; policy: Policy }
  | { kind: "call_attempt"; at: string; phase: Phase; party_id: string; phone_masked: string; slot_id: string | null; idempotency_key: string; payload_digest: string }
  | { kind: "call_accepted"; at: string; idempotency_key: string; call_id: string }
  | { kind: "gather"; at: string; feasible_before: string[]; result: GatherResult; feasible_after: string[] }
  | { kind: "slot_chosen"; at: string; slot_id: string; feasible: string[] }
  | { kind: "commit"; at: string; result: CommitResult }
  | { kind: "release"; at: string; result: CommitResult }
  | { kind: "resume_started"; at: string; entries_before: number; ambiguous: string[]; owed_releases: string[] }
  | { kind: "reconcile"; at: string; placed_call: boolean; result: CommitResult }
  | { kind: "outcome"; at: string; outcome: Outcome; slot_id: string | null; confirmed_with: string[]; unreleased: string[]; calls_placed: number; note: string };

export interface RunResult {
  request_id: string;
  outcome: Outcome;
  slot_id: string | null;
  slot_spoken: string | null;
  confirmed_with: string[];
  unreleased: string[];
  calls_placed: number;
  calls_saved: number;
  note: string;
  ledger_path: string | null;
}

export interface ReplayIssue {
  entry: number;
  problem: string;
}

export interface ReplayVerification {
  ok: boolean;
  entries: number;
  outcome: Outcome | null;
  issues: ReplayIssue[];
}
