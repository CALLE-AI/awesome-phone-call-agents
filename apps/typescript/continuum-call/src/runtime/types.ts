/**
 * Continuum Call — core types for Phase 1 runtime (no live dials).
 */

export type IntentState =
  | "planned"
  | "dispatching"
  | "run_known"
  | "ambiguous"
  | "terminal"
  | "cancelled";

export type ProviderRunState =
  | "accepted"
  | "ringing"
  | "completed"
  | "failed"
  | "unknown";

/** Conversation result — never confuse with IntentState. */
export type BusinessOutcome =
  | "candidate_accepted"
  | "verbally_confirmed"
  | "practice_acknowledged"
  | "declined"
  | "no_answer"
  | "voicemail"
  | "callback_requested"
  | "unresolved";

export type MissionStatus =
  | "running"
  | "paused"
  | "blocked_needs_resolution"
  | "cancellation_requested"
  | "completed"
  | "cancelled";

export type Actor = "system" | "operator" | "provider" | "agent";

export interface CanonicalCallPayload {
  task: string;
  recipients: Array<{
    phones: string[];
    region?: string;
    locale?: string;
  }>;
  metadata: Record<string, unknown>;
  result_schema?: Record<string, unknown>;
  recipient_result_schema?: Record<string, unknown>;
}

export interface CallTask {
  call_task_id: string;
  mission_id: string;
  goal: string;
  recipient_label: string;
  /** Frozen template node that owns dependency policy for this task. */
  graph_node_id?: string;
  /** Facts that must already exist and be payload-bound before authorization. */
  required_facts?: string[];
}

export interface CallIntent {
  call_intent_id: string;
  call_task_id: string;
  attempt_no: number;
  state: IntentState;
  canonical_call_payload: CanonicalCallPayload;
  payload_sha256: string;
  provider_idempotency_key: string;
  provider_run_id: string | null;
  business_outcome: BusinessOutcome | null;
  /** Canonical hash of the accepted terminal provider result (ingest idempotency). */
  result_fingerprint: string | null;
  /** Sanitized facts derived only from a validated terminal provider result. */
  validated_facts?: Record<string, string>;
  consent_recorded: boolean;
  timezone: string;
}

export interface ProviderRun {
  provider_run_id: string;
  call_intent_id: string;
  provider_state: ProviderRunState;
  raw_status: string | null;
}

export interface StructuredFact {
  fact: string;
  value: string;
  confirmedBy: string;
  sourceRunId: string;
  sourceCallIntentId: string;
  sourceAttemptNo: number;
}

export interface MissionEvent {
  /** Hash envelope version. v2 binds event identity + all semantic metadata. */
  hash_version: 2;
  event_id: string;
  mission_id: string;
  sequence_no: number;
  event_type: string;
  actor: Actor;
  occurred_at: string;
  call_task_id?: string;
  call_intent_id?: string;
  provider_run_id?: string;
  prev_hash: string | null;
  event_hash: string;
  redacted_payload: Record<string, unknown>;
}

export interface Mission {
  mission_id: string;
  mission_idempotency_key: string;
  client_request_id: string;
  status: MissionStatus;
  template_id: string;
  template_version: number;
  graph_snapshot: Record<string, unknown>;
  prompt_version: number;
  outcome_schema_version: number;
  created_at: string;
}
