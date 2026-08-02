/**
 * Deterministic readiness scoring from drill attempts.
 */

import type { AfterActionReport, CallAttemptRecord, DrillRecord, StructuredDrillResult } from "./types.js";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function primarySuccess(result: StructuredDrillResult | null): boolean {
  return (
    result !== null &&
    result.reached_live_person &&
    result.acknowledged_scenario &&
    result.can_take_ownership &&
    !result.opt_out
  );
}

export function scoreContactability(attempts: CallAttemptRecord[]): number {
  if (attempts.length === 0) {
    return 0;
  }
  const reached = attempts.filter(
    (attempt) =>
      attempt.outcome === "success" ||
      (attempt.structuredResult?.reached_live_person === true &&
        attempt.outcome !== "opt_out" &&
        attempt.outcome !== "malformed_result"),
  ).length;
  return clampScore((reached / attempts.length) * 100);
}

export function scoreAcknowledgement(attempts: CallAttemptRecord[]): number {
  const withResult = attempts.filter((attempt) => attempt.structuredResult !== null);
  if (withResult.length === 0) {
    return 0;
  }
  const acknowledged = withResult.filter((attempt) => attempt.structuredResult?.acknowledged_scenario === true).length;
  return clampScore((acknowledged / withResult.length) * 100);
}

export function scoreRoleCoverage(attempts: CallAttemptRecord[]): number {
  const withResult = attempts.filter((attempt) => attempt.structuredResult !== null);
  if (withResult.length === 0) {
    return 0;
  }
  const covered = withResult.filter((attempt) => attempt.structuredResult?.can_take_ownership === true).length;
  return clampScore((covered / withResult.length) * 100);
}

export function scoreEscalationCorrectness(drill: DrillRecord, attempts: CallAttemptRecord[]): number {
  if (attempts.length === 0) {
    return 0;
  }
  const primary = attempts.find((attempt) => attempt.role === "primary");
  if (primary === undefined) {
    return 0;
  }
  if (primarySuccess(primary.structuredResult)) {
    return attempts.length === 1 ? 100 : 70;
  }
  if (drill.backup === null) {
    return primary.outcome === "success" ? 100 : 40;
  }
  const backup = attempts.find((attempt) => attempt.role === "backup");
  if (backup === undefined) {
    return 20;
  }
  if (primarySuccess(backup.structuredResult)) {
    return 85;
  }
  return 30;
}

export function scoreFollowUpNeeds(attempts: CallAttemptRecord[]): number {
  const flags = attempts.flatMap((attempt) => {
    const result = attempt.structuredResult;
    if (result === null) {
      return [true];
    }
    return [result.follow_up_required, result.needs_help, result.opt_out];
  });
  if (flags.length === 0) {
    return 100;
  }
  const needing = flags.filter(Boolean).length;
  return clampScore((needing / flags.length) * 100);
}

export function buildScores(drill: DrillRecord, attempts: CallAttemptRecord[]): AfterActionReport["scores"] {
  return {
    contactability: scoreContactability(attempts),
    acknowledgement: scoreAcknowledgement(attempts),
    roleCoverage: scoreRoleCoverage(attempts),
    escalationCorrectness: scoreEscalationCorrectness(drill, attempts),
    followUpNeeds: scoreFollowUpNeeds(attempts),
  };
}

export function buildRecommendations(drill: DrillRecord, attempts: CallAttemptRecord[]): string[] {
  const recommendations: string[] = [];
  const scores = buildScores(drill, attempts);
  if (scores.contactability < 100) {
    recommendations.push("Verify on-call contact paths and voicemail coverage for unreachable roles.");
  }
  if (scores.acknowledgement < 100) {
    recommendations.push("Re-brief primary responders on the outage drill script and acknowledgement cues.");
  }
  if (scores.roleCoverage < 100) {
    recommendations.push("Confirm backup ownership assignments and runbook handoff steps.");
  }
  if (drill.backup !== null && attempts.length === 1 && attempts[0]?.role === "primary") {
    recommendations.push("Primary did not meet success criteria; review whether backup escalation should have occurred.");
  }
  if (scores.followUpNeeds >= 50) {
    recommendations.push("Schedule follow-up for roles that requested help, opted out, or flagged follow-up.");
  }
  if (attempts.some((attempt) => attempt.outcome === "malformed_result")) {
    recommendations.push("Investigate malformed provider results and tighten structured-result validation.");
  }
  if (attempts.some((attempt) => attempt.ambiguous)) {
    recommendations.push("Reconcile ambiguous provider states before relying on this drill for compliance evidence.");
  }
  const retainedCallIds = attempts
    .filter((attempt) => attempt.ambiguous && attempt.callId !== null)
    .map((attempt) => attempt.callId as string);
  if (retainedCallIds.length > 0) {
    recommendations.push(
      `Reconcile the retained provider call ID (${retainedCallIds.join(", ")}) with CALL-E before placing any new call.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("Drill met readiness criteria for the configured scenario. Retain the masked audit record.");
  }
  return recommendations;
}

export function buildSummary(drill: DrillRecord, attempts: CallAttemptRecord[]): string {
  const scores = buildScores(drill, attempts);
  const roleReady = attempts.some(
    (attempt) =>
      attempt.structuredResult !== null &&
      attempt.structuredResult.can_take_ownership &&
      attempt.structuredResult.acknowledged_scenario,
  );
  return [
    `Scenario ${drill.scenario} finished in ${drill.status}.`,
    `${attempts.length} call attempt(s), max allowed ${drill.maxCalls}.`,
    roleReady ? "At least one role demonstrated ownership readiness." : "No role demonstrated full ownership readiness.",
    `Scores — contactability ${scores.contactability}, acknowledgement ${scores.acknowledgement}, role coverage ${scores.roleCoverage}, escalation ${scores.escalationCorrectness}, follow-up needs ${scores.followUpNeeds}.`,
  ].join(" ");
}
