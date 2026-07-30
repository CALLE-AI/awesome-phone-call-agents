/**
 * Shared types for the delegated errand caller.
 *
 * CALL-E snapshot types are declared locally so preview and report rendering run
 * with no SDK installed. They match what `@call-e/calle` returns: camelCase on
 * the call, recipient and attempt and API-shaped transcript turns.
 */

/** What the caller may agree to on the person's behalf, if anything. */
export type CommitmentMode = "none" | "slot_within_windows" | "confirm_existing";

export type ErrandOutcome =
  | "goal_met"
  | "partially_met"
  | "not_met"
  | "callee_declined_automated"
  | "voicemail"
  | "not_reached"
  | "call_failed"
  /** CALL-E refused to create the call, so nothing was said. */
  | "api_error"
  /** The call may have run and this app could not read what happened. */
  | "outcome_unknown";

export type CommitmentState =
  | "none_sought"
  | "committed"
  | "proposal_only"
  | "declined_by_callee"
  | "outside_authorized_window"
  /** The extraction claimed an agreement the transcript does not show. */
  | "unconfirmed";

export type AnswerShape = "text" | "yes_no" | "datetime";

/** One fact the person has authorized the caller to say out loud. */
export interface DisclosureItem {
  key: string;
  /** How the report names it, for example "date of birth". */
  label: string;
  value: string;
}

export interface ErrandQuestion {
  id: string;
  text: string;
  answer: AnswerShape;
}

export interface AuthorizedWindow {
  from: string;
  to: string;
}

export interface OnBehalfOf {
  name: string;
  /** The consent record only. It is never sent to CALL-E and never spoken. */
  reason_for_delegation: string;
}

export interface Callee {
  name: string;
  phone: string;
  /** Where the number was published. A number nobody published is not an errand target. */
  published_source: string;
  region?: string;
}

export interface Goal {
  summary: string;
  commitment: CommitmentMode;
}

export interface PolicyInput {
  per_call_timeout_seconds?: number;
  language?: string;
  leave_voicemail?: boolean;
  min_confidence?: number;
}

export interface Policy {
  perCallTimeoutSeconds: number;
  language: string;
  leaveVoicemail: boolean;
  minConfidence: number;
}

export interface ErrandRequestInput {
  errand_id: string;
  on_behalf_of: OnBehalfOf;
  callee: Callee;
  goal: Goal;
  disclosure: DisclosureItem[];
  questions: ErrandQuestion[];
  authorized_windows?: AuthorizedWindow[];
  policy?: PolicyInput;
}

export interface ErrandRequest {
  errandId: string;
  onBehalfOf: OnBehalfOf;
  callee: Callee;
  goal: Goal;
  disclosure: DisclosureItem[];
  questions: ErrandQuestion[];
  authorizedWindows: AuthorizedWindow[];
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

/** Something that looks like a personal detail and is not in the budget. */
export interface DisclosureFinding {
  kind: string;
  /** Masked on purpose. A privacy report that quotes the leak is not a privacy report. */
  masked: string;
  where: string;
  severity: "block" | "warn";
}

export interface QuestionAnswer {
  id: string;
  text: string;
  answered: boolean;
  answer: string;
  /** The callee turn that supports the answer. Empty means nothing supported it. */
  quote: string;
}

export interface ErrandReport {
  errand_id: string;
  on_behalf_of: string;
  callee_name: string;
  callee_phone_masked: string;
  outcome: ErrandOutcome;
  commitment: CommitmentState;
  committed_datetime: string | null;
  confirmation_code: string;
  answers: QuestionAnswer[];
  disclosed: string[];
  authorized_but_unused: string[];
  leaks: DisclosureFinding[];
  reached_person: boolean;
  callee_notes: string;
  next_step: string;
  call_id: string | null;
  provider_call_id: string | null;
  call_status: string;
  started_at: string | null;
  completed_at: string | null;
  /** Verbatim, because the whole point is that the person gets to read it. */
  transcript: TranscriptTurn[];
}
