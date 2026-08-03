import assert from "node:assert/strict";
import test from "node:test";
import type { CallePort, CreateCallInput } from "../src/calle.js";
import {
  DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS,
  resolvePerCallTimeoutMs,
  runDrill,
} from "../src/orchestrator.js";
import type { CallSnapshot, DrillRecord } from "../src/types.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

test("DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS is exactly 30 minutes", () => {
  assert.equal(DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS, THIRTY_MINUTES_MS);
  assert.equal(DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS, 1_800_000);
});

test("resolvePerCallTimeoutMs uses the 30-minute production default", () => {
  assert.equal(resolvePerCallTimeoutMs(), DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS);
  assert.equal(resolvePerCallTimeoutMs(undefined), DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS);
});

test("resolvePerCallTimeoutMs keeps explicit perCallTimeoutMs overrides", () => {
  assert.equal(resolvePerCallTimeoutMs(50), 50);
  assert.equal(resolvePerCallTimeoutMs(5_000), 5_000);
});

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

function armedDrill(): DrillRecord {
  return {
    id: "drill-orchestrator-timeout-1",
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
    launchClaim: { idempotencyKey: "orchestrator-timeout-key", claimedAt: "2026-01-01T00:00:00.000Z", claimedBy: "test" },
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
  };
}

test("runDrill honors explicit perCallTimeoutMs override during result monitoring", async () => {
  const provider = new TimeoutAfterCreateProvider("call_explicit_monitoring_timeout");
  const started = Date.now();
  const finished = await runDrill(armedDrill(), {
    port: provider,
    perCallTimeoutMs: 50,
    pollIntervalMs: 10,
  });
  const elapsed = Date.now() - started;

  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts[0]?.ambiguous, true);
  assert.equal(finished.attempts[0]?.outcome, "timeout");
  assert.equal(provider.createdIds.length, 1);
  assert.ok(elapsed < 500, `expected fast override timeout, elapsed ${elapsed}ms`);
  assert.ok(elapsed >= 40, `expected ~50ms monitoring window, elapsed ${elapsed}ms`);
});
