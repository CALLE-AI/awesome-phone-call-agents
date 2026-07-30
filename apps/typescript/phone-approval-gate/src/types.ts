/**
 * Shared types for the phone approval gate.
 *
 * CALL-E snapshot types are declared locally so preview and audit verification
 * run with no SDK installed. They match what `@call-e/calle` returns: camelCase
 * fields on the call, recipient and attempt and API-shaped transcript turns.
 *
 * Everything that reaches an audit record or the JSON output uses snake_case,
 * so a record can be read back into the same shapes it was written from.
 */

export type PolicyMode = "single" | "dual";
export type Binding = "code_from_request" | "liveness_phrase";
export type Decision = "approve" | "reject" | "unknown";
export type Verdict = "approved" | "rejected" | "not_approved";

/** Why an approval was not granted. Every value is a hard stop, never a retry hint. */
export type NotApprovedReason =
  | "no_answer"
  | "voicemail"
  | "call_failed"
  | "code_mismatch"
  | "no_decision"
  | "no_transcript_evidence"
  | "low_confidence"
  | "disagreement"
  | "window_expired"
  | "attempt_limit"
  | "quorum_not_met"
  | "not_reached"
  | "timed_out"
  | "api_error"
  /**
   * A create or a poll failed without saying whether the call exists, and
   * reading it back under the same idempotency key did not settle it. A call
   * may be live, so the ladder stops here.
   */
  | "call_state_unknown";

export interface Approver {
  id: string;
  name: string;
  phone: string;
  region?: string;
  locale?: string;
  enrolled_at: string;
  authorized_for: string[];
}

export interface Change {
  title: string;
  summary: string;
  environment: string;
  requested_by: string;
  links?: string[];
}

export interface PolicyInput {
  mode?: PolicyMode;
  binding?: Binding;
  per_call_timeout_seconds?: number;
  window_seconds?: number;
  min_confidence?: number;
  max_failed_attempts?: number;
}

export interface Policy {
  mode: PolicyMode;
  binding: Binding;
  perCallTimeoutSeconds: number;
  windowSeconds: number;
  minConfidence: number;
  maxFailedAttempts: number;
}

/** Shape of the request file on disk. */
export interface ApprovalRequestInput {
  request_id: string;
  organization?: string;
  system?: string;
  change: Change;
  policy?: PolicyInput;
  approvers: Approver[];
}

/** Validated request with policy defaults resolved. */
export interface ApprovalRequest {
  requestId: string;
  organization: string;
  system: string;
  change: Change;
  policy: Policy;
  approvers: Approver[];
}

/** The subset of JSON Schema the CALL-E result contract supports. */
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

/** What the local transcript reader found in the recipient turns. */
export interface TranscriptReading {
  secretSpoken: boolean;
  spokenDigits: string | null;
  decisionSignal: Decision;
  userTurnCount: number;
  excerpt: string[];
}

/**
 * Every input the outcome depends on. It is stored verbatim in the audit
 * record, so the recorded outcome can be recomputed later from the same inputs
 * by the same function.
 */
export interface OutcomeInputs {
  call_status: string;
  failure_code: string | null;
  reached_person: boolean;
  machine_answered: boolean;
  /** False when the decision landed outside the window this run opened. */
  within_window: boolean;
  transcript_available: boolean;
  code_match: boolean;
  decision: Decision;
  structured_decision: Decision | null;
  confidence: Confidence | null;
}

export interface AttemptEvaluation {
  approver_id: string;
  phone_masked: string;
  call_id: string | null;
  provider_call_id: string | null;
  outcome: Verdict;
  reason: NotApprovedReason | null;
  evidence: OutcomeInputs;
  secret_digest: string;
  spoken_secret_digest: string | null;
  transcript_excerpt: string[];
  started_at: string | null;
  completed_at: string | null;
}

export interface AuditPolicy {
  mode: PolicyMode;
  binding: Binding;
  per_call_timeout_seconds: number;
  window_seconds: number;
  min_confidence: number;
  max_failed_attempts: number;
}

export interface AuditRecord {
  seq: number;
  recorded_at: string;
  request_id: string;
  request_digest: string;
  change: Change;
  policy: AuditPolicy;
  secret_delivery: "request_channel" | "spoken_on_call";
  attempts: AttemptEvaluation[];
  verdict: Verdict;
  reason: NotApprovedReason | null;
  approved_by: string[];
  prev_hash: string;
  hash: string;
}

export interface GateResult {
  verdict: Verdict;
  reason: NotApprovedReason | null;
  request_id: string;
  approved_by: string[];
  attempts: AttemptEvaluation[];
  audit_record_hash: string | null;
}

export interface AuditIssue {
  seq: number;
  problem: string;
}

export interface AuditVerification {
  ok: boolean;
  records: number;
  issues: AuditIssue[];
}
