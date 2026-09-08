// src/domain/types.ts
// Canonical TypeScript interfaces for Verity (PRD §5). SQLite DDL mirrors these.
// This file grows step by step; Step 1 lands the CALL-E integration DTOs (PRD §5.7,
// mirror of §1 — NOT owned by Verity, snake_case to match the wire + replay fixtures).

// ─── Shared value objects ────────────────────────────────────────────────────

/** A concrete appointment slot value Verity is willing to stand behind (PRD §5.1). */
export interface BookingValue {
  appointment_date: string; // YYYY-MM-DD
  appointment_time: string; // HH:mm (24h)
  timezone: string; // IANA, e.g. "America/New_York"
  service_type: string;
}

/** One transcript line, flattened from recipients[0].attempts[last] (PRD §5.1). */
export interface TranscriptTurn {
  offset_seconds: number | null; // null when the source line had no parseable timestamp
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export type Intent = "book" | "reschedule" | "confirm";

export type VerificationState =
  | "hold_placed"
  | "call_created"
  | "awaiting_result"
  | "reconciling"
  | "verifying"
  | "gate_allow"
  | "gate_block"
  | "repair_pending"
  | "committed"
  | "needs_human"
  | "cancelled"
  | "call_failed";

// ─── Normalized CALL-E snapshot (ARCH §4.1) ─────────────────────────────────
// What the pipeline sees after the P1 re-fetch — never the raw SDK/webhook type.

export interface CalleSnapshot {
  call_id: string;
  status: CalleCallStatus | null;
  task_completed: boolean | null;
  completion_confidence: CalleCompletionConfidence | null;
  structured_result: Record<string, unknown> | null; // cross-check only (DECISIONS D4)
  summary: string | null;
  evidence: string[];
  failure_code: string | null; // opaque, never branched (PRD §1.11)
  transcript: TranscriptTurn[]; // flattened recipients[0].attempts[last].transcript_turns
  transcript_partial: boolean; // no user turn / truncated / empty
  metadata: Record<string, unknown>;
  created_at: string; // call creation time — anchors relative-date resolution
  snapshot_hash: string; // sha256 of the canonical snapshot — gate idempotency key
}

// ─── Transcript parser output (PRD §6.5) ────────────────────────────────────

export interface ResolvedDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (24h)
  timezone: string; // IANA
}

export interface CandidateDateTime {
  turn_index: number;
  speaker: "bot" | "user" | "unknown";
  raw_text: string;
  resolved?: ResolvedDateTime; // absent if unresolvable
  resolution_confidence: "high" | "medium" | "low";
  is_relative: boolean; // "tomorrow", "next Thursday", a bare weekday
  relative_resolutions?: string[]; // >1 ⇒ ambiguous
}

export interface CorrectionEvent {
  cue: string;
  turn_index: number;
  before_turn_index: number | null;
  after_turn_index: number | null;
}

export interface ParsedTranscript {
  candidate_datetimes: CandidateDateTime[];
  resolved_targets: ResolvedDateTime[]; // after self-correction resolution; deduped
  correction_events: CorrectionEvent[];
  explicit_confirmation: boolean; // strict E4 (ARCH §4.3 step 5)
  confirmation_turn_index: number | null;
  timezone_source: "explicit" | "business_default" | "unknown";
  partial: boolean;
  parse_confidence: "high" | "medium" | "low";
}

// ─── Action gate I/O (PRD §6.1) ────────────────────────────────────────────

export type FixtureExpectedBehavior =
  | "force_sms_confirmation"
  | "block_hard"
  | "allow_with_note";

/** The slice of a regression fixture the pure gate reads (full type: Step 10). */
export interface GateFixture {
  fixture_id: string;
  expected_behavior: FixtureExpectedBehavior;
}

export interface EvidenceRefs {
  transcript_turn_indexes?: number[];
  parsed_field?: string;
  fixture_id?: string;
  calle_field?: string;
}

export interface GateInput {
  intent: Intent;
  intended_value: BookingValue;
  original_hold: {
    hold_id: string;
    slot_id: string;
    value: BookingValue;
    expires_at: string;
  };
  calle: {
    status: string;
    task_completed: boolean | null;
    completion_confidence: { score: number; label: string } | null;
    structured_result: Record<string, unknown> | null;
  };
  parsed: ParsedTranscript;
  ambiguity: AmbiguityReport;
  matched_fixtures: GateFixture[];
  slot_recheck: SlotRecheck;
  now: string; // ISO 8601
}

export interface Decision {
  decision: "ALLOW" | "BLOCK";
  reason_code: string; // §6.4
  reason_detail: string;
  repair_target: BookingValue | null;
  ghost_booking_prevented: boolean;
  evidence_refs: EvidenceRefs | null;
}

// ─── Ambiguity detector output (PRD §6.6) ──────────────────────────────────

export type AmbiguityFlag =
  | "self_correction_unresolved"
  | "multi_time_mention_unresolved"
  | "relative_date_ambiguity"
  | "no_explicit_confirmation"
  | "claim_parse_mismatch";

export interface AmbiguityReport {
  flags: AmbiguityFlag[];
  matched_fixture_ids: string[];
  details: Record<string, unknown>;
}

/** Fresh deterministic slot state taken < 2 s before decide() (PRD §6.1). */
export interface SlotRecheck {
  slot_id: string;
  held_by_hold_id: string | null;
  available: boolean;
  sandbox_ok: boolean;
}

// ─── Calendar sandbox contract (PRD §9.3, ARCH §4.5) ────────────────────────

export type SandboxErrorCode =
  | "SlotConflict"
  | "SlotExpired"
  | "SandboxUnavailable"
  | "NotFound";

export type Result<T> = { ok: true; value: T } | { ok: false; error: SandboxErrorCode };

/** The four sources that may back a committed booking value (SECURITY §7, PRD §6.7). */
export type VerifiedValueSource =
  | "caller_confirmation"
  | "deterministic_check"
  | "sms_reply"
  | "operator";

export interface CustomerInfo {
  name: string;
  phone: string; // E.164
  /** Set by the pipeline when it commits post-ALLOW; required before mark_confirmed. */
  verified_value_source?: VerifiedValueSource;
}

// ─── CALL-E integration DTOs (PRD §1.5–§1.9, §5.7) ───────────────────────────
// Verity's own snake_case mirror of the CALL-E wire shapes. The @call-e/calle SDK
// returns camelCase objects; LiveTransport converts to these so the downstream
// pipeline (normalize → parse → gate) is byte-identical in live and replay modes.

export type CalleCallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface CalleCompletionConfidence {
  score: number; // 0..1
  label: string; // observed: "low" | "medium" | "high"
}

export interface CalleTranscriptTurn {
  offset_seconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export interface CalleCallAttempt {
  id: string;
  phone: string;
  status: "queued" | "dialing" | "in_progress" | "completed" | "failed" | "canceled";
  started_at: string | null;
  ended_at: string | null;
  summary: string | null;
  transcript_turns: CalleTranscriptTurn[];
  provider_call_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface CalleCallRecipient {
  id: string;
  phones: string[];
  locale: string | null;
  region: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  structured_result: Record<string, unknown> | null;
  summary: string | null;
  attempts: CalleCallAttempt[];
}

/** The `CallTask` shape Verity consumes (PRD §1.6). Returned by `CalleTransport.getCall`. */
export interface CalleCallTask {
  id: string; // ^call_...
  object: "call_task";
  status: CalleCallStatus;
  task: string;
  recipients: CalleCallRecipient[];
  structured_result: Record<string, unknown> | null; // cross-check only (DECISIONS D4)
  summary: string | null;
  task_completed: boolean | null; // THE CLAIM (DECISIONS D3)
  completion_confidence: CalleCompletionConfidence | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  failure_code: string | null; // opaque, never branched on (PRD §1.11)
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/** `POST /v1/calls` request body (PRD §1.5). */
export interface CreateCallRequest {
  task: string;
  recipients?: Array<{ phones: string[]; region?: string; locale?: string }>;
  result_schema?: Record<string, unknown>;
  recipient_result_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  webhook_url?: string;
}

export type CalleWebhookEventType =
  | "call.completed"
  | "call.failed"
  | "call.result_validation_failed";

/** `WebhookEvent` (PRD §1.9 / §5.7). The body is never acted on directly (ARCH P1). */
export interface CalleWebhookEvent {
  id: string; // ^evt_...
  type: CalleWebhookEventType;
  created_at: string;
  data: CalleCallTask; // full terminal snapshot
}
