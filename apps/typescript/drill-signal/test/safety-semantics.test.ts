import assert from "node:assert/strict";
import test from "node:test";
import { CalleApiError } from "../src/calle.js";
import type { CallePort, CreateCallInput } from "../src/calle.js";
import { runDrill } from "../src/orchestrator.js";
import { presetScenarios, SimulationProvider } from "../src/provider/simulation.js";
import { MIN_COMPLETION_CONFIDENCE_SCORE } from "../src/structured-trust.js";
import type { CallSnapshot, DrillRecord, StructuredDrillResult } from "../src/types.js";

const SUCCESS_RESULT: StructuredDrillResult = {
  reached_live_person: true,
  acknowledged_scenario: true,
  can_take_ownership: true,
  first_action: "Open the incident bridge.",
  escalation_target: null,
  needs_help: false,
  follow_up_required: false,
  opt_out: false,
};

function successSnapshot(overrides: Partial<CallSnapshot> = {}): CallSnapshot {
  const structured = SUCCESS_RESULT as unknown as Record<string, unknown>;
  return {
    id: overrides.id ?? "call_test_1",
    status: overrides.status ?? "completed",
    recipients: overrides.recipients ?? [
      {
        id: "rcp_1",
        phones: ["+15550100001"],
        status: "completed",
        structuredResult: null,
        summary: "done",
        attempts: [
          {
            id: "att_1",
            phone: "+15550100001",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [{ offset_seconds: 0, speaker: "bot", text: "Drill call." }],
            providerCallId: "provider_1",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: overrides.structuredResult === undefined ? structured : overrides.structuredResult,
    summary: "done",
    taskCompleted: overrides.taskCompleted ?? true,
    completionConfidence: overrides.completionConfidence ?? { score: 0.95, label: "high" },
    evidence: ["bot: Drill call."],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

function armedDrill(overrides: Partial<DrillRecord> = {}): DrillRecord {
  return {
    id: "drill-safety-1",
    scenario: "production_outage",
    status: "armed",
    mode: "simulation",
    primary: {
      role: "primary",
      label: "Primary",
      phone: "+15550100001",
      phoneMasked: "+*******0001",
      consented: true,
    },
    backup: {
      role: "backup",
      label: "Backup",
      phone: "+15550100003",
      phoneMasked: "+*******0003",
      consented: true,
    },
    maxCalls: 2,
    consent: {
      primaryAttested: true,
      backupAttested: true,
      operatorConfirmedDrillPurpose: true,
      maxCallsDisclosed: true,
      liveSideEffectAcknowledged: false,
      launchConfirmed: true,
    },
    callsPlaced: 0,
    launchClaim: { idempotencyKey: "safety-key", claimedAt: "2026-01-01T00:00:00.000Z", claimedBy: "test" },
    simulationPreset: null,
    events: [],
    attempts: [],
    report: null,
    cancelRequested: false,
    cancelBoundary: null,
    activeProviderCallId: null,
    activeProviderCallRole: null,
    reconciliationRequired: false,
    reconciliationReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class StaticSnapshotProvider implements CallePort {
  readonly createdIds: string[] = [];
  private index = 0;

  constructor(private readonly snapshots: CallSnapshot[]) {}

  async createCall(_input: CreateCallInput, _idempotencyKey: string): Promise<CallSnapshot> {
    const snapshot = this.snapshots[this.index] ?? this.snapshots[this.snapshots.length - 1]!;
    this.index += 1;
    this.createdIds.push(snapshot.id);
    return { ...snapshot, status: "queued", taskCompleted: null, completionConfidence: null };
  }

  async getCall(callId: string): Promise<CallSnapshot> {
    const snapshot = this.snapshots.find((candidate) => candidate.id === callId) ?? this.snapshots[0]!;
    return snapshot;
  }

  async waitForResult(callId: string): Promise<CallSnapshot> {
    return this.getCall(callId);
  }
}

class TimeoutAfterCreateProvider implements CallePort {
  readonly createdIds: string[] = [];

  constructor(private readonly callId: string) {}

  async createCall(_input: CreateCallInput, _idempotencyKey: string): Promise<CallSnapshot> {
    this.createdIds.push(this.callId);
    return {
      id: this.callId,
      status: "queued",
      recipients: [],
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      failureCode: null,
      failureMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    };
  }

  async getCall(callId: string): Promise<CallSnapshot> {
    return {
      id: callId,
      status: "in_progress",
      recipients: [],
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      failureCode: null,
      failureMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    };
  }

  async waitForResult(): Promise<CallSnapshot> {
    throw new Error("unused");
  }
}

class AmbiguousAfterCreateProvider implements CallePort {
  readonly createdIds: string[] = [];

  constructor(private readonly callId: string) {}

  async createCall(_input: CreateCallInput, _idempotencyKey: string): Promise<CallSnapshot> {
    this.createdIds.push(this.callId);
    return {
      id: this.callId,
      status: "queued",
      recipients: [],
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      failureCode: null,
      failureMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    };
  }

  async getCall(): Promise<CallSnapshot> {
    throw new CalleApiError("upstream_timeout", "provider read failed", 408);
  }

  async waitForResult(): Promise<CallSnapshot> {
    throw new Error("unused");
  }
}

test("valid top-level structured result with null recipient result succeeds", async () => {
  const port = new StaticSnapshotProvider([successSnapshot()]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(finished.status, "completed");
  assert.equal(finished.attempts[0]?.outcome, "success");
  assert.ok(finished.attempts[0]?.structuredResult);
  assert.equal(finished.attempts.length, 1);
});

test("recipient-level structured result is used when top-level result is null", async () => {
  const structured = SUCCESS_RESULT as unknown as Record<string, unknown>;
  const snapshot = successSnapshot({
    structuredResult: null,
    recipients: [
      {
        id: "rcp_1",
        phones: ["+15550100001"],
        status: "completed",
        structuredResult: structured,
        summary: "done",
        attempts: [
          {
            id: "att_1",
            phone: "+15550100001",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_1",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
  });
  const finished = await runDrill(armedDrill(), { port: new StaticSnapshotProvider([snapshot]) });
  assert.equal(finished.status, "completed");
  assert.equal(finished.attempts[0]?.outcome, "success");
});

test("taskCompleted false cannot succeed and does not call backup", async () => {
  const snapshot = successSnapshot({ taskCompleted: false });
  const port = new StaticSnapshotProvider([snapshot]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts[0]?.structuredResult, null);
  assert.equal(port.createdIds.length, 1);
});

test("taskCompleted null cannot succeed and does not call backup", async () => {
  const snapshot = successSnapshot({ taskCompleted: null });
  const port = new StaticSnapshotProvider([snapshot]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts[0]?.structuredResult, null);
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.equal(port.createdIds.length, 1);
});

test("missing confidence cannot succeed and does not call backup", async () => {
  const snapshot = successSnapshot({ completionConfidence: null });
  const finished = await runDrill(armedDrill(), { port: new StaticSnapshotProvider([snapshot]) });
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts.length, 1);
});

test("confidence below minimum cannot succeed and does not call backup", async () => {
  const snapshot = successSnapshot({
    completionConfidence: { score: MIN_COMPLETION_CONFIDENCE_SCORE - 0.01, label: "medium" },
  });
  const finished = await runDrill(armedDrill(), { port: new StaticSnapshotProvider([snapshot]) });
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts.length, 1);
});

test("confidence at minimum is accepted", async () => {
  const snapshot = successSnapshot({
    completionConfidence: { score: MIN_COMPLETION_CONFIDENCE_SCORE, label: "acceptable" },
  });
  const finished = await runDrill(armedDrill(), { port: new StaticSnapshotProvider([snapshot]) });
  assert.equal(finished.status, "completed");
  assert.equal(finished.attempts[0]?.outcome, "success");
  assert.ok(finished.attempts[0]?.structuredResult);
});

test("timeout with configured backup creates one call, ends ambiguous, retains primary call ID", async () => {
  const provider = new TimeoutAfterCreateProvider("call_timeout_1");
  const finished = await runDrill(armedDrill(), {
    port: provider,
    perCallTimeoutMs: 50,
    pollIntervalMs: 10,
  });
  assert.equal(provider.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.attempts[0]?.callId, "call_timeout_1");
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.equal(finished.activeProviderCallId, "call_timeout_1");
  assert.equal(finished.activeProviderCallRole, "primary");
  assert.equal(finished.reconciliationRequired, true);
  assert.equal(finished.reconciliationReason, "timeout");
  assert.ok(
    finished.events.some(
      (evt) =>
        evt.message.includes("Reconcile the retained provider call ID") &&
        (evt.detail ?? "").includes("providerCallId=call_timeout_1") &&
        !(evt.detail ?? "").includes("+1555") &&
        !evt.message.includes("+1555"),
    ),
  );
  assert.ok(
    finished.report?.recommendations.some(
      (line) => line.includes("call_timeout_1") && !line.includes("+1555"),
    ),
  );
});

test("ambiguous API failure creates no backup, ends ambiguous, and retains call ID when creation succeeded", async () => {
  const provider = new AmbiguousAfterCreateProvider("call_ambiguous_1");
  const finished = await runDrill(armedDrill(), { port: provider, pollIntervalMs: 10 });
  assert.equal(provider.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.attempts[0]?.callId, "call_ambiguous_1");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
});

test("malformed completed result never escalates to backup", async () => {
  const snapshot = successSnapshot({
    id: "call_malformed_1",
    structuredResult: { reached_live_person: true, incomplete: true },
    taskCompleted: true,
    recipients: [
      {
        id: "rcp_1",
        phones: ["+15550100001"],
        status: "completed",
        structuredResult: { reached_live_person: true, incomplete: true },
        summary: "done",
        attempts: [],
      },
    ],
  });
  const port = new StaticSnapshotProvider([snapshot]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(port.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.attempts[0]?.outcome, "malformed_result");
  assert.equal(finished.attempts[0]?.callId, "call_malformed_1");
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.ok(
    finished.events.some(
      (evt) =>
        evt.message.includes("Reconcile the retained provider call ID") &&
        (evt.detail ?? "").includes("providerCallId=call_malformed_1"),
    ),
  );
  assert.ok(
    finished.report?.recommendations.some(
      (line) => line.includes("call_malformed_1") && line.includes("Reconcile the retained provider call ID"),
    ),
  );
});

test("terminal failed unknown snapshot ends ambiguous, retains call ID, does not call backup", async () => {
  const primaryFailed: CallSnapshot = {
    id: "call_primary_unknown",
    status: "failed",
    recipients: [
      {
        id: "rcp_primary",
        phones: ["+15550100001"],
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_primary",
            phone: "+15550100001",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_primary",
            failureCode: "carrier_error",
            failureMessage: "unclassified failure",
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    failureCode: "carrier_error",
    failureMessage: "unclassified failure",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const port = new StaticSnapshotProvider([primaryFailed, successSnapshot({ id: "call_backup_should_not_run" })]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(port.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts[0]?.callId, "call_primary_unknown");
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.ok(
    finished.events.some(
      (evt) =>
        evt.message.includes("Reconcile the retained provider call ID") &&
        (evt.detail ?? "").includes("providerCallId=call_primary_unknown"),
    ),
  );
  assert.ok(
    finished.report?.recommendations.some(
      (line) => line.includes("call_primary_unknown") && line.includes("Reconcile the retained provider call ID"),
    ),
  );
});

test("terminal definitive no_answer still escalates to backup", async () => {
  const primaryFailed: CallSnapshot = {
    id: "call_primary_no_answer",
    status: "failed",
    recipients: [
      {
        id: "rcp_primary",
        phones: ["+15550100002"],
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_primary",
            phone: "+15550100002",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_primary",
            failureCode: "no_answer",
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    failureCode: "no_answer",
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const backupSuccess = successSnapshot({ id: "call_backup_success" });
  const port = new StaticSnapshotProvider([primaryFailed, backupSuccess]);
  const finished = await runDrill(
    armedDrill({
      primary: {
        role: "primary",
        label: "Primary",
        phone: "+15550100002",
        phoneMasked: "+*******0002",
        consented: true,
      },
    }),
    { port },
  );
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.attempts[0]?.outcome, "no_answer");
  assert.equal(finished.attempts[0]?.ambiguous, false);
  assert.equal(finished.attempts[1]?.role, "backup");
  assert.equal(finished.status, "completed");
});

test("ambiguous backup outcome ends drill ambiguous", async () => {
  const primaryFailed: CallSnapshot = {
    id: "call_primary_no_answer",
    status: "failed",
    recipients: [
      {
        id: "rcp_primary",
        phones: ["+15550100002"],
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_primary",
            phone: "+15550100002",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_primary",
            failureCode: "no_answer",
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    failureCode: "no_answer",
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const untrustedBackup = successSnapshot({
    id: "call_backup_untrusted",
    taskCompleted: false,
  });
  const finished = await runDrill(
    armedDrill({
      primary: {
        role: "primary",
        label: "Primary",
        phone: "+15550100002",
        phoneMasked: "+*******0002",
        consented: true,
      },
    }),
    { port: new StaticSnapshotProvider([primaryFailed, untrustedBackup]) },
  );
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[1]?.ambiguous, true);
});

test("simulation preset primary-unavailable-backup-success still completes via public runDrill path", async () => {
  SimulationProvider.createCallCount = 0;
  const finished = await runDrill(
    armedDrill({
      primary: {
        role: "primary",
        label: "Primary",
        phone: "+15550100002",
        phoneMasked: "+*******0002",
        consented: true,
      },
      simulationPreset: "primary-unavailable-backup-success",
    }),
    { port: new SimulationProvider(presetScenarios("primary-unavailable-backup-success")) },
  );
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.status, "completed");
  assert.equal(finished.reconciliationRequired, false);
  assert.equal(finished.activeProviderCallId, null);
});

test("failed terminal with conflicting structured contact evidence does not escalate", async () => {
  const conflicting: CallSnapshot = {
    id: "call_conflict_1",
    status: "failed",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+15550100001"],
        status: "failed",
        structuredResult: {
          reached_live_person: true,
          acknowledged_scenario: true,
          can_take_ownership: true,
          first_action: "Opened bridge",
          escalation_target: null,
          needs_help: false,
          follow_up_required: false,
          opt_out: false,
        },
        summary: null,
        attempts: [
          {
            id: "att_1",
            phone: "+15550100001",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [{ offset_seconds: 1, speaker: "user", text: "I can take ownership." }],
            providerCallId: "provider_conflict",
            failureCode: "no_answer",
            failureMessage: "reported no answer",
          },
        ],
      },
    ],
    structuredResult: {
      reached_live_person: true,
      acknowledged_scenario: true,
      can_take_ownership: true,
      first_action: "Opened bridge",
      escalation_target: null,
      needs_help: false,
      follow_up_required: false,
      opt_out: false,
    },
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: ["user: I can take ownership."],
    failureCode: "no_answer",
    failureMessage: "reported no answer",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const port = new StaticSnapshotProvider([conflicting, successSnapshot({ id: "call_backup_should_not_run" })]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(port.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.equal(finished.reconciliationRequired, true);
  assert.equal(finished.reconciliationReason, "conflicting_evidence");
  assert.equal(finished.activeProviderCallId, "call_conflict_1");
});

test("failed terminal with incomplete evidence does not escalate", async () => {
  const incomplete: CallSnapshot = {
    id: "call_incomplete_1",
    status: "failed",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+15550100001"],
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_1",
            phone: "+15550100001",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_incomplete",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const port = new StaticSnapshotProvider([incomplete, successSnapshot({ id: "call_backup_should_not_run" })]);
  const finished = await runDrill(armedDrill(), { port });
  assert.equal(port.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.outcome, "unknown");
  assert.equal(finished.reconciliationRequired, true);
  assert.equal(finished.reconciliationReason, "incomplete_evidence");
  assert.equal(finished.activeProviderCallId, "call_incomplete_1");
});

test("crash-like polling exception retains provider ID and reconciliation state without backup", async () => {
  const provider = new AmbiguousAfterCreateProvider("call_crash_1");
  const finished = await runDrill(armedDrill(), { port: provider, pollIntervalMs: 10 });
  assert.equal(provider.createdIds.length, 1);
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.activeProviderCallId, "call_crash_1");
  assert.equal(finished.reconciliationRequired, true);
  assert.ok(finished.reconciliationReason === "provider_error" || finished.reconciliationReason === "interrupted");
});

test("definitive busy failure escalates like unavailable", async () => {
  const primaryBusy: CallSnapshot = {
    id: "call_primary_busy",
    status: "failed",
    recipients: [
      {
        id: "rcp_primary",
        phones: ["+15550100002"],
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_primary",
            phone: "+15550100002",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            summary: null,
            transcriptTurns: [],
            providerCallId: "provider_primary",
            failureCode: "busy",
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    failureCode: "busy",
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  const port = new StaticSnapshotProvider([primaryBusy, successSnapshot({ id: "call_backup_after_busy" })]);
  const finished = await runDrill(
    armedDrill({
      primary: {
        role: "primary",
        label: "Primary",
        phone: "+15550100002",
        phoneMasked: "+*******0002",
        consented: true,
      },
    }),
    { port },
  );
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.attempts[0]?.outcome, "no_answer");
  assert.equal(finished.attempts[0]?.ambiguous, false);
  assert.equal(finished.status, "completed");
  assert.equal(finished.reconciliationRequired, false);
});

test("unknown failure codes containing busy remain ambiguous and do not escalate", async () => {
  const failed = successSnapshot({
    id: "call_primary_busy_substring",
    status: "failed",
    structuredResult: null,
    taskCompleted: false,
    completionConfidence: null,
    failureCode: "busybox_internal_error",
    recipients: [],
  });
  const provider = new StaticSnapshotProvider([failed, successSnapshot({ id: "call_backup_should_not_run" })]);

  const result = await runDrill(armedDrill({ id: "busy-substring-is-not-definitive" }), { port: provider });

  assert.equal(provider.createdIds.length, 1);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.attempts[0]?.outcome, "unknown");
  assert.equal(result.reconciliationRequired, true);
});
