/** Deterministic operator-dashboard fixtures for Call-E command center demos and tests. */

import type {
  OperatorDashboardCall,
  OperatorDashboardFixture,
  OperatorDashboardSnapshot,
  OperatorIncident,
  OperatorProviderHealth,
} from "./types";

const T0 = "2026-09-14T12:00:00.000Z";

function minutesAgo(minutes: number): string {
  return new Date(Date.parse(T0) - minutes * 60_000).toISOString();
}

function call(partial: OperatorDashboardCall): OperatorDashboardCall {
  return partial;
}

export const OPERATOR_PROVIDER_HEALTH_FIXTURES: readonly OperatorProviderHealth[] = [
  {
    id: "call-e",
    circuit: "open",
    consecutiveFailures: 3,
    acceptedCalls: 41,
    lastFailureCode: "provider_unavailable",
    lastFailureAt: minutesAgo(2),
    lastSuccessAt: minutesAgo(48),
  },
  {
    id: "backup-phone-api",
    circuit: "closed",
    consecutiveFailures: 0,
    acceptedCalls: 12,
    lastFailureCode: null,
    lastFailureAt: null,
    lastSuccessAt: minutesAgo(4),
  },
  {
    id: "tertiary-phone-api",
    circuit: "half_open",
    consecutiveFailures: 2,
    acceptedCalls: 3,
    lastFailureCode: "timeout",
    lastFailureAt: minutesAgo(18),
    lastSuccessAt: minutesAgo(180),
  },
];

export const OPERATOR_DASHBOARD_FIXTURES: readonly OperatorDashboardFixture[] = [
  {
    id: "dash-pending-prepared",
    title: "Prepared follow-up waiting on CHW confirm",
    purpose: "Operator sees the call before a live or dry-run dial.",
    synthetic: true,
    replayId: "replay-e2e-complete",
    call: call({
      id: "demo-wf-asha-001",
      bucket: "pending",
      phoneStatus: "approved",
      purpose: "follow_up_after_check_in",
      womanId: "demo-ben-001",
      recipientMasked: "+1•••555•0101",
      status: "prepared",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 0,
      canRetry: false,
      failureCode: null,
      phoneProviderId: null,
      failoverAttempts: 0,
      replayId: "replay-e2e-complete",
      createdAt: minutesAgo(20),
      updatedAt: minutesAgo(18),
    }),
  },
  {
    id: "dash-active-in-progress",
    title: "Backup phone API is currently dialing",
    purpose: "Active bucket after CALL-E outage failed over to the backup API.",
    synthetic: true,
    replayId: "replay-e2e-provider-failover",
    call: call({
      id: "demo-wf-failover-active",
      bucket: "active",
      phoneStatus: "in_progress",
      purpose: "appointment_coordination",
      womanId: "demo-ben-004",
      recipientMasked: "+1•••555•0104",
      status: "in_progress",
      policyDecision: "allow",
      dryRun: true,
      attemptCount: 1,
      canRetry: false,
      failureCode: null,
      phoneProviderId: "backup-phone-api",
      failoverAttempts: 2,
      replayId: "replay-e2e-provider-failover",
      createdAt: minutesAgo(8),
      updatedAt: minutesAgo(1),
    }),
    incident: {
      kind: "failover",
      workflowId: "demo-wf-failover-active",
      summary: "Phone API failover to backup-phone-api after 2 attempts",
      fromProvider: "call-e",
      toProvider: "backup-phone-api",
    },
  },
  {
    id: "dash-completed-dry-run",
    title: "Dry-run completed without a live dial",
    purpose: "Happy-path completed row for the command center.",
    synthetic: true,
    replayId: "replay-e2e-complete",
    call: call({
      id: "demo-wf-maya-003",
      bucket: "completed",
      phoneStatus: "completed",
      purpose: "callback_confirmation",
      womanId: "demo-ben-003",
      recipientMasked: "+1•••555•0103",
      status: "dry_run_completed",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 1,
      canRetry: false,
      failureCode: null,
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: "replay-e2e-complete",
      createdAt: minutesAgo(90),
      updatedAt: minutesAgo(80),
    }),
  },
  {
    id: "dash-blocked-consent",
    title: "Outreach blocked after consent refusal",
    purpose: "Operators must not retry a DNC / consent-denied contact.",
    synthetic: true,
    replayId: "replay-e2e-refusal",
    call: call({
      id: "demo-wf-refusal-001",
      bucket: "blocked",
      phoneStatus: "blocked",
      purpose: "follow_up_after_check_in",
      womanId: "demo-ben-011",
      recipientMasked: "+1•••555•0111",
      status: "prepared",
      policyDecision: "deny",
      dryRun: true,
      attemptCount: 0,
      canRetry: false,
      failureCode: "missing_consent",
      phoneProviderId: null,
      failoverAttempts: 0,
      replayId: "replay-e2e-refusal",
      createdAt: minutesAgo(40),
      updatedAt: minutesAgo(39),
    }),
    incident: {
      kind: "consent_block",
      workflowId: "demo-wf-refusal-001",
      summary: "REST/MCP outreach suppressed after SMS consent denial",
    },
  },
  {
    id: "dash-failed-outage",
    title: "All phone APIs unavailable",
    purpose: "Failed bucket when ordered failover exhausts without accepting a run.",
    synthetic: true,
    replayId: "replay-e2e-failover-exhausted",
    call: call({
      id: "demo-wf-outage-009",
      bucket: "failed",
      phoneStatus: "failed",
      purpose: "follow_up_after_check_in",
      womanId: "demo-ben-009",
      recipientMasked: "+1•••555•0109",
      status: "failed",
      policyDecision: "allow",
      dryRun: true,
      attemptCount: 1,
      canRetry: true,
      failureCode: "provider_unavailable",
      phoneProviderId: "tertiary-phone-api",
      failoverAttempts: 3,
      replayId: "replay-e2e-failover-exhausted",
      createdAt: minutesAgo(12),
      updatedAt: minutesAgo(11),
    }),
    incident: {
      kind: "provider_outage",
      workflowId: "demo-wf-outage-009",
      summary: "call-e, backup-phone-api, and tertiary-phone-api all failed to accept the dial",
      fromProvider: "call-e",
      toProvider: "tertiary-phone-api",
    },
  },
  {
    id: "dash-review-unknown",
    title: "Low-confidence / unknown outcome needs CHW review",
    purpose: "Review bucket for operators before a second outreach.",
    synthetic: true,
    call: call({
      id: "demo-wf-noora-002",
      bucket: "needs_review",
      phoneStatus: "needs_review",
      purpose: "appointment_coordination",
      womanId: "demo-ben-002",
      recipientMasked: "+1•••555•0102",
      status: "unknown",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 1,
      canRetry: true,
      failureCode: null,
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: null,
      createdAt: minutesAgo(70),
      updatedAt: minutesAgo(55),
    }),
  },
  {
    id: "dash-timeout-retry",
    title: "Transient timeout is eligible for the same idempotency key",
    purpose: "Failed/retry row paired with the transient REST replay fixture.",
    synthetic: true,
    replayId: "replay-e2e-transient-retry",
    call: call({
      id: "demo-wf-timeout-011",
      bucket: "failed",
      phoneStatus: "failed",
      purpose: "callback_confirmation",
      womanId: "demo-ben-011b",
      recipientMasked: "+1•••555•0112",
      status: "failed",
      policyDecision: "allow",
      dryRun: true,
      attemptCount: 1,
      canRetry: true,
      failureCode: "timeout",
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: "replay-e2e-transient-retry",
      createdAt: minutesAgo(6),
      updatedAt: minutesAgo(5),
    }),
    incident: {
      kind: "timeout",
      workflowId: "demo-wf-timeout-011",
      summary: "CALL-E timed out; retry must reuse the same run_id",
    },
  },
  {
    id: "dash-safety-escalation",
    title: "Safety script completed; probing stopped",
    purpose: "Completed-but-reviewable row after a distress replay.",
    synthetic: true,
    replayId: "replay-e2e-distress",
    call: call({
      id: "demo-wf-safety-033",
      bucket: "needs_review",
      phoneStatus: "needs_review",
      purpose: "follow_up_after_check_in",
      womanId: "demo-ben-033",
      recipientMasked: "+1•••555•0133",
      status: "completed",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 1,
      canRetry: false,
      failureCode: null,
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: "replay-e2e-distress",
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(28),
    }),
    incident: {
      kind: "safety",
      workflowId: "demo-wf-safety-033",
      summary: "Distress answer persisted as a safety code; no further survey probes",
    },
  },
  {
    id: "dash-voicemail-callback",
    title: "Voicemail left; evening callback requested",
    purpose: "CHW queue pairing for the Tongi mock household.",
    synthetic: true,
    call: call({
      id: "demo-wf-rumana-014",
      bucket: "needs_review",
      phoneStatus: "voicemail",
      purpose: "callback_confirmation",
      womanId: "demo-ben-008",
      recipientMasked: "+1•••555•0108",
      status: "completed",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 1,
      canRetry: true,
      failureCode: null,
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: null,
      createdAt: minutesAgo(16),
      updatedAt: minutesAgo(15),
    }),
  },
  {
    id: "dash-busy-iron",
    title: "Busy during nap window",
    purpose: "Busy-line fixture for iron-adherence counseling.",
    synthetic: true,
    call: call({
      id: "demo-wf-yasmin-012",
      bucket: "failed",
      phoneStatus: "busy",
      purpose: "follow_up_after_check_in",
      womanId: "demo-ben-012",
      recipientMasked: "+1•••555•0112",
      status: "failed",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 1,
      canRetry: true,
      failureCode: "busy",
      phoneProviderId: "call-e",
      failoverAttempts: 1,
      replayId: null,
      createdAt: minutesAgo(22),
      updatedAt: minutesAgo(21),
    }),
  },
  {
    id: "dash-new-registration",
    title: "First ANC slot held, visit still pending",
    purpose: "Pending bucket for a newly registered household.",
    synthetic: true,
    call: call({
      id: "demo-wf-nasrin-013",
      bucket: "pending",
      phoneStatus: "queued",
      purpose: "appointment_coordination",
      womanId: "demo-ben-013",
      recipientMasked: "+1•••555•0113",
      status: "prepared",
      policyDecision: "dry_run",
      dryRun: true,
      attemptCount: 0,
      canRetry: false,
      failureCode: null,
      phoneProviderId: null,
      failoverAttempts: 0,
      replayId: null,
      createdAt: minutesAgo(50),
      updatedAt: minutesAgo(49),
    }),
  },
];

export function summarizeOperatorCalls(
  calls: readonly OperatorDashboardCall[],
): OperatorDashboardSnapshot["summary"] {
  const summary: OperatorDashboardSnapshot["summary"] = {
    pending: 0,
    active: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    needs_review: 0,
  };
  for (const row of calls) summary[row.bucket] += 1;
  return summary;
}

export function collectOperatorIncidents(
  fixtures: readonly OperatorDashboardFixture[] = OPERATOR_DASHBOARD_FIXTURES,
): OperatorIncident[] {
  return fixtures.flatMap((fixture) => (fixture.incident ? [fixture.incident] : []));
}

export function buildOperatorDashboard(
  fixtures: readonly OperatorDashboardFixture[] = OPERATOR_DASHBOARD_FIXTURES,
  providerHealth: readonly OperatorProviderHealth[] = OPERATOR_PROVIDER_HEALTH_FIXTURES,
): OperatorDashboardSnapshot {
  const calls = fixtures.map((fixture) => fixture.call);
  return {
    summary: summarizeOperatorCalls(calls),
    calls,
    providerHealth: [...providerHealth],
    incidents: collectOperatorIncidents(fixtures),
  };
}

export function getOperatorDashboardFixture(id: string): OperatorDashboardFixture {
  const fixture = OPERATOR_DASHBOARD_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown operator dashboard fixture: ${id}`);
  return fixture;
}

export function operatorDashboardReplayIds(): string[] {
  return [
    ...new Set(
      OPERATOR_DASHBOARD_FIXTURES.map((item) => item.replayId).filter((id): id is string => Boolean(id)),
    ),
  ];
}

export const OPERATOR_DASHBOARD_SNAPSHOT = buildOperatorDashboard();
