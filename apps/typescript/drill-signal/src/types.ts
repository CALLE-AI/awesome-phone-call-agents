/**
 * DrillSignal shared types.
 */

export type DrillMode = "simulation" | "fake-server" | "live";

export type DrillScenario = "production_outage";

export type DrillStatus =
  | "draft"
  | "preview_ready"
  | "armed"
  | "launching"
  | "calling_primary"
  | "evaluating_primary"
  | "calling_backup"
  | "evaluating_backup"
  | "completed"
  | "failed"
  | "cancelled"
  | "ambiguous";

export type ContactRole = "primary" | "backup";

export interface DrillContactInput {
  label: string;
  phone: string;
  consented: boolean;
}

export interface DrillContact {
  role: ContactRole;
  label: string;
  /** Full E.164 retained only while the drill is active; redacted after terminal state. */
  phone?: string;
  phoneMasked: string;
  consented: boolean;
}

export interface DrillConsent {
  primaryAttested: boolean;
  backupAttested: boolean;
  operatorConfirmedDrillPurpose: boolean;
  maxCallsDisclosed: boolean;
  /** Required in Safety Preview when mode is live — acknowledges real outbound calls. */
  liveSideEffectAcknowledged: boolean;
  launchConfirmed: boolean;
}

export interface StructuredDrillResult {
  reached_live_person: boolean;
  acknowledged_scenario: boolean;
  can_take_ownership: boolean;
  first_action: string;
  escalation_target: string | null;
  needs_help: boolean;
  follow_up_required: boolean;
  opt_out: boolean;
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

export interface CallSnapshot {
  id: string;
  status: string;
  recipients: CallRecipientSnapshot[];
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  evidence: string[];
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type CallOutcomeKind =
  | "success"
  | "no_answer"
  | "voicemail"
  | "refused_ownership"
  | "opt_out"
  | "malformed_result"
  | "api_error"
  | "timeout"
  | "unknown"
  | "cancelled";

export interface CallAttemptRecord {
  role: ContactRole;
  callId: string | null;
  phoneMasked: string;
  status: string;
  outcome: CallOutcomeKind;
  structuredResult: StructuredDrillResult | null;
  evidenceExcerpt: string[];
  failureCode: string | null;
  ambiguous: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReadinessScores {
  contactability: number;
  acknowledgement: number;
  roleCoverage: number;
  escalationCorrectness: number;
  followUpNeeds: number;
}

export interface AfterActionReport {
  generatedAt: string;
  scenario: DrillScenario;
  mode: DrillMode;
  status: DrillStatus;
  attempts: CallAttemptRecord[];
  scores: ReadinessScores;
  summary: string;
  recommendations: string[];
  evidence: string[];
}

export interface LaunchClaim {
  idempotencyKey: string;
  claimedAt: string;
  claimedBy: string;
}

export interface DrillEvent {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

/** Why an accepted provider call must be reconciled with CALL-E before any new call. */
export type ReconciliationReason =
  | "timeout"
  | "unknown"
  | "malformed_result"
  | "provider_error"
  | "interrupted"
  | "untrusted_completed"
  | "conflicting_evidence"
  | "incomplete_evidence"
  | "cancelled_with_active_call";

export interface DrillRecord {
  id: string;
  scenario: DrillScenario;
  status: DrillStatus;
  mode: DrillMode;
  primary: DrillContact;
  backup: DrillContact | null;
  maxCalls: number;
  consent: DrillConsent;
  callsPlaced: number;
  launchClaim: LaunchClaim | null;
  simulationPreset: string | null;
  events: DrillEvent[];
  attempts: CallAttemptRecord[];
  report: AfterActionReport | null;
  cancelRequested: boolean;
  cancelBoundary: string | null;
  /**
   * Provider call ID accepted by createCall, checkpointed before the first poll.
   * Retained through timeout/unknown/interrupted/reconciliation; cleared only after
   * a terminal result is safely evaluated and recorded without recon need.
   */
  activeProviderCallId: string | null;
  activeProviderCallRole: ContactRole | null;
  /** Operator must reconcile with CALL-E; never auto-retry while true. */
  reconciliationRequired: boolean;
  reconciliationReason: ReconciliationReason | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDrillBody {
  primaryLabel: string;
  primaryPhone: string;
  primaryConsented: boolean;
  backupLabel?: string;
  backupPhone?: string;
  backupConsented?: boolean;
  mode?: DrillMode;
  simulationPreset?: string;
}

export interface PreviewAckBody {
  operatorConfirmedDrillPurpose: boolean;
  maxCallsDisclosed: boolean;
  liveSideEffectAcknowledged?: boolean;
}

export interface LaunchBody {
  launchConfirmed: boolean;
  idempotencyKey?: string;
  /** Locked at creation — launch rejects overrides. */
  mode?: DrillMode;
  /** Locked at creation — launch rejects overrides. */
  simulationPreset?: string;
}

export const TERMINAL_STATUSES: readonly DrillStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "ambiguous",
];

export const TERMINAL_CALL_STATUSES: readonly string[] = ["completed", "failed", "canceled"];

export function isTerminalDrillStatus(status: DrillStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isTerminalCallStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_CALL_STATUSES.includes(status.trim().toLowerCase());
}
