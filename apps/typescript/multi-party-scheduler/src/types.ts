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

export type Outcome =
  | "booked"
  | "no_common_slot"
  | "not_confirmed"
  | "window_expired"
  | "budget_exhausted"
  | "not_reached"
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

export interface PartyInput {
  id: string;
  name: string;
  phone: string;
  role: string;
  region?: string;
  locale?: string;
}

export interface Party {
  id: string;
  name: string;
  phone: string;
  role: string;
  region?: string;
  locale?: string;
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

/** What one confirm or release call established for one party. */
export interface CommitResult {
  party_id: string;
  phone_masked: string;
  phase: Phase;
  slot_id: string;
  call_id: string | null;
  provider_call_id: string | null;
  call_status: string;
  confirmed: boolean;
  declined: boolean;
  acknowledged: boolean;
  reached_person: boolean;
  machine_answered: boolean;
  structured_answer: string | null;
  heard_answer: string | null;
  disagreement: boolean;
  confidence: Confidence | null;
  transcript_excerpt: string[];
  failure_code: string | null;
}

export type LedgerEntry =
  | { kind: "run_started"; at: string; request_id: string; request_digest: string; slots: Slot[]; parties: string[]; policy: Policy }
  | { kind: "gather"; at: string; feasible_before: string[]; result: GatherResult; feasible_after: string[] }
  | { kind: "slot_chosen"; at: string; slot_id: string; feasible: string[] }
  | { kind: "commit"; at: string; result: CommitResult }
  | { kind: "release"; at: string; result: CommitResult }
  | { kind: "outcome"; at: string; outcome: Outcome; slot_id: string | null; booked_with: string[]; unreleased: string[]; calls_placed: number; note: string };

export interface RunResult {
  request_id: string;
  outcome: Outcome;
  slot_id: string | null;
  slot_spoken: string | null;
  booked_with: string[];
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
