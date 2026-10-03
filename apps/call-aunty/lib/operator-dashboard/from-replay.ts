import type { EndToEndReplayFixture, ReplayState } from "../mock-calls/replay";
import type { OperatorBucket, OperatorDashboardCall, OperatorIncident, OperatorPhoneStatus } from "./types";

function bucketFromReplay(state: ReplayState): OperatorBucket {
  if (state.outreachSuppressed || state.status === "policy_block" || state.status === "declined") {
    return "blocked";
  }
  if (state.status === "safety_escalation" || state.escalation === "safety_script") return "needs_review";
  if (state.status === "in_progress" || state.status === "queued" || state.status === "started") return "active";
  if (state.status === "failed" || state.status === "timeout" || state.status === "error") return "failed";
  if (state.status === "completed" || state.status === "dry_run_completed") return "completed";
  if (state.status === "blocked") return "blocked";
  return "pending";
}

function phoneStatusFromReplay(state: ReplayState): OperatorPhoneStatus {
  const bucket = bucketFromReplay(state);
  if (bucket === "blocked") return "blocked";
  if (bucket === "failed") return "failed";
  if (bucket === "needs_review") return "needs_review";
  if (bucket === "active") return state.status === "queued" ? "queued" : "in_progress";
  if (bucket === "completed") return "completed";
  return "approved";
}

function failureCodeFromReplay(state: ReplayState): string | null {
  if (state.outreachSuppressed) return "missing_consent";
  if (state.status === "timeout") return "timeout";
  if (state.status === "failed" || state.status === "error") return "provider_unavailable";
  return null;
}

function incidentFromReplay(
  fixture: EndToEndReplayFixture,
  state: ReplayState,
  workflowId: string,
): OperatorIncident | undefined {
  if (state.failoverAttempts > 1 && state.phoneProviderId) {
    return {
      kind: state.status === "failed" ? "provider_outage" : "failover",
      workflowId,
      summary: `Phone API failover after ${state.failoverAttempts} attempts; winner=${state.phoneProviderId ?? "none"}`,
      fromProvider: "call-e",
      toProvider: state.phoneProviderId,
    };
  }
  if (state.outreachSuppressed) {
    return {
      kind: "consent_block",
      workflowId,
      summary: "Outreach suppressed after consent or DNC",
    };
  }
  if (state.escalation === "safety_script") {
    return {
      kind: "safety",
      workflowId,
      summary: "Safety script stopped further probing",
    };
  }
  if (state.status === "timeout") {
    return {
      kind: "timeout",
      workflowId,
      summary: "Transient timeout; retry must reuse run_id",
    };
  }
  return {
    kind: "replay",
    workflowId,
    summary: fixture.purpose,
  };
}

/** Project a finished replay onto one operator-dashboard row. */
export function operatorCallFromReplay(
  fixture: EndToEndReplayFixture,
  state: ReplayState,
): OperatorDashboardCall {
  const now = "2026-09-14T12:00:00.000Z";
  return {
    id: `dash-replay-${fixture.id}`,
    bucket: bucketFromReplay(state),
    phoneStatus: phoneStatusFromReplay(state),
    purpose: "follow_up_after_check_in",
    womanId: fixture.contactId,
    recipientMasked: "+1•••555•0000",
    status: state.status,
    policyDecision: state.outreachSuppressed ? "deny" : "dry_run",
    dryRun: true,
    attemptCount: Math.max(1, state.failoverAttempts),
    canRetry: bucketFromReplay(state) === "failed",
    failureCode: failureCodeFromReplay(state),
    phoneProviderId: state.phoneProviderId,
    failoverAttempts: state.failoverAttempts,
    replayId: fixture.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function operatorIncidentFromReplay(
  fixture: EndToEndReplayFixture,
  state: ReplayState,
): OperatorIncident | undefined {
  return incidentFromReplay(fixture, state, `dash-replay-${fixture.id}`);
}
