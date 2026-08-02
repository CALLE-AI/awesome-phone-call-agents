/**
 * Drill state machine — deterministic transitions and escalation rules.
 */

import type {
  CallAttemptRecord,
  CallOutcomeKind,
  ContactRole,
  DrillRecord,
  DrillStatus,
  StructuredDrillResult,
} from "./types.js";
import { isTerminalDrillStatus } from "./types.js";

export class StateTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function maxCallsForDrill(drill: Pick<DrillRecord, "backup" | "consent">): number {
  if (drill.backup !== null && drill.consent.backupAttested && drill.backup.consented) {
    return 2;
  }
  return 1;
}

export function canEscalateToBackup(drill: DrillRecord, primaryOutcome: CallOutcomeKind): boolean {
  if (drill.backup === null || !drill.consent.backupAttested || !drill.backup.consented) {
    return false;
  }
  if (drill.callsPlaced >= drill.maxCalls) {
    return false;
  }
  if (primaryOutcome === "success") {
    return false;
  }
  return ["no_answer", "voicemail", "refused_ownership", "opt_out"].includes(primaryOutcome);
}

export function classifyPrimaryOutcome(
  outcome: CallOutcomeKind,
  result: StructuredDrillResult | null,
): CallOutcomeKind {
  if (outcome !== "success" || result === null) {
    return outcome;
  }
  if (result.opt_out) {
    return "opt_out";
  }
  if (!result.reached_live_person) {
    return "no_answer";
  }
  if (!result.can_take_ownership) {
    return "refused_ownership";
  }
  return "success";
}

export function nextStatusAfterPrimaryEvaluation(
  drill: DrillRecord,
  primaryOutcome: CallOutcomeKind,
): DrillStatus {
  if (drill.cancelRequested) {
    return "cancelled";
  }
  const lastAttempt = drill.attempts.at(-1);
  if (lastAttempt?.ambiguous) {
    return "ambiguous";
  }
  if (primaryOutcome === "success") {
    return "completed";
  }
  if (canEscalateToBackup(drill, primaryOutcome)) {
    return "calling_backup";
  }
  if (
    primaryOutcome === "api_error" ||
    primaryOutcome === "timeout" ||
    primaryOutcome === "unknown" ||
    primaryOutcome === "malformed_result"
  ) {
    return "ambiguous";
  }
  return "completed";
}

export function nextStatusAfterBackupEvaluation(drill: DrillRecord, backupOutcome: CallOutcomeKind): DrillStatus {
  if (drill.cancelRequested) {
    return "cancelled";
  }
  const lastAttempt = drill.attempts.at(-1);
  if (lastAttempt?.ambiguous) {
    return "ambiguous";
  }
  if (
    backupOutcome === "api_error" ||
    backupOutcome === "timeout" ||
    backupOutcome === "unknown" ||
    backupOutcome === "malformed_result"
  ) {
    return "ambiguous";
  }
  return "completed";
}

export function assertTransition(current: DrillStatus, allowed: DrillStatus[]): void {
  if (!allowed.includes(current)) {
    throw new StateTransitionError(
      "invalid_state",
      `Drill cannot transition from ${current}; expected one of ${allowed.join(", ")}.`,
    );
  }
}

export function transitionToPreview(drill: DrillRecord): DrillRecord {
  assertTransition(drill.status, ["draft"]);
  return { ...drill, status: "preview_ready", updatedAt: new Date().toISOString() };
}

export function transitionToArmed(drill: DrillRecord): DrillRecord {
  assertTransition(drill.status, ["preview_ready"]);
  if (!drill.consent.operatorConfirmedDrillPurpose || !drill.consent.maxCallsDisclosed) {
    throw new StateTransitionError("consent_incomplete", "Preview consent attestations are incomplete.");
  }
  if (drill.mode === "live" && !drill.consent.liveSideEffectAcknowledged) {
    throw new StateTransitionError(
      "live_ack_missing",
      "Live side-effect acknowledgment is required before arming a live drill.",
    );
  }
  return { ...drill, status: "armed", updatedAt: new Date().toISOString() };
}

export function transitionToLaunching(drill: DrillRecord, claim: DrillRecord["launchClaim"]): DrillRecord {
  assertTransition(drill.status, ["armed"]);
  if (!drill.consent.launchConfirmed) {
    throw new StateTransitionError("launch_unconfirmed", "Launch confirmation is required.");
  }
  if (claim === null) {
    throw new StateTransitionError("launch_unclaimed", "Launch claim is required.");
  }
  return {
    ...drill,
    status: "launching",
    launchClaim: claim,
    updatedAt: new Date().toISOString(),
  };
}

export function transitionToCalling(drill: DrillRecord, role: ContactRole): DrillRecord {
  const status = role === "primary" ? "calling_primary" : "calling_backup";
  assertTransition(drill.status, role === "primary" ? ["launching", "evaluating_primary"] : ["calling_backup", "evaluating_primary"]);
  return { ...drill, status, updatedAt: new Date().toISOString() };
}

export function transitionToEvaluating(drill: DrillRecord, role: ContactRole): DrillRecord {
  const status = role === "primary" ? "evaluating_primary" : "evaluating_backup";
  return { ...drill, status, updatedAt: new Date().toISOString() };
}

export function applyTerminalStatus(drill: DrillRecord, status: DrillStatus): DrillRecord {
  if (isTerminalDrillStatus(status)) {
    return redactContacts({ ...drill, status, updatedAt: new Date().toISOString() });
  }
  return { ...drill, status, updatedAt: new Date().toISOString() };
}

export function redactContacts(drill: DrillRecord): DrillRecord {
  return {
    ...drill,
    primary: { ...drill.primary, phone: undefined },
    backup: drill.backup ? { ...drill.backup, phone: undefined } : null,
  };
}

const IN_FLIGHT_STATUSES: readonly DrillStatus[] = [
  "launching",
  "calling_primary",
  "evaluating_primary",
  "calling_backup",
  "evaluating_backup",
];

export function isInFlightDrillStatus(status: DrillStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

/** True when any persisted or in-flight signal means launch must not place calls. */
export function launchSideEffectsBlocked(drill: DrillRecord): boolean {
  if (isTerminalDrillStatus(drill.status)) {
    return true;
  }
  if (isInFlightDrillStatus(drill.status)) {
    return true;
  }
  if (drill.launchClaim !== null) {
    return true;
  }
  if (drill.attempts.length > 0) {
    return true;
  }
  if (drill.cancelRequested) {
    return true;
  }
  return false;
}

/** @deprecated Use launchSideEffectsBlocked */
export function duplicateLaunchBlocked(drill: DrillRecord): boolean {
  return launchSideEffectsBlocked(drill);
}

export function contactForRole(drill: DrillRecord, role: ContactRole) {
  return role === "primary" ? drill.primary : drill.backup;
}

export function recordAttempt(drill: DrillRecord, attempt: CallAttemptRecord): DrillRecord {
  return {
    ...drill,
    attempts: [...drill.attempts, attempt],
    callsPlaced: drill.callsPlaced + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function cancelBoundaryMessage(callsPlaced: number, activeCallId: string | null): string {
  if (callsPlaced === 0) {
    return "No provider call has started. Cancellation stops the drill immediately.";
  }
  if (activeCallId !== null) {
    return `A provider call (${activeCallId}) may already be ringing or in progress. DrillSignal can stop orchestration locally, but an active call cannot be guaranteed stopped once accepted by the telephony provider. Use CALL-E dashboard controls if available.`;
  }
  return "Orchestration is stopped locally. Any call already accepted by the provider may still complete.";
}
