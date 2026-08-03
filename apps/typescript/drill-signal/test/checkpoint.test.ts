/**
 * Durable provider-call checkpoint and reconciliation regression tests.
 * All tests are fast: short perCallTimeoutMs or immediate terminal snapshots.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CallePort, CreateCallInput } from "../src/calle.js";
import { CalleApiError } from "../src/calle.js";
import { runDrill } from "../src/orchestrator.js";
import { launchSideEffectsBlocked } from "../src/state-machine.js";
import { JsonDrillStore } from "../src/store.js";
import * as service from "../src/service.js";
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

function successSnapshot(id: string): CallSnapshot {
  const structured = SUCCESS_RESULT as unknown as Record<string, unknown>;
  return {
    id,
    status: "completed",
    recipients: [
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
            transcriptTurns: [],
            providerCallId: "provider_1",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: structured,
    summary: "done",
    taskCompleted: true,
    completionConfidence: { score: 0.95, label: "high" },
    evidence: [],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
}

function armedDrill(id: string): DrillRecord {
  return {
    id,
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
    launchClaim: { idempotencyKey: `key-${id}`, claimedAt: "2026-01-01T00:00:00.000Z", claimedBy: "test" },
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

test("accepted provider call ID is durably checkpointed in JsonDrillStore before first getCall poll", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-checkpoint-"));
  const store = new JsonDrillStore(dir);
  const drillId = "drill-checkpoint-before-poll";
  store.save(armedDrill(drillId));

  let getCallCount = 0;
  const provider: CallePort = {
    async createCall(_input: CreateCallInput, _key: string): Promise<CallSnapshot> {
      return {
        id: "call_checkpoint_1",
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
    },
    async getCall(callId: string): Promise<CallSnapshot> {
      getCallCount += 1;
      // On the first poll, durable store must already hold the accepted ID + role.
      const persisted = store.get(drillId);
      assert.ok(persisted, "drill must exist in store before first poll");
      assert.equal(persisted.activeProviderCallId, "call_checkpoint_1");
      assert.equal(persisted.activeProviderCallRole, "primary");
      assert.equal(persisted.reconciliationRequired, false);
      assert.ok(
        persisted.events.some((evt) => evt.message.includes("durable checkpoint")),
        "checkpoint event must be recorded before first poll",
      );
      return successSnapshot(callId);
    },
    async waitForResult(callId: string): Promise<CallSnapshot> {
      return this.getCall(callId);
    },
  };

  const finished = await runDrill(store.get(drillId)!, {
    port: provider,
    pollIntervalMs: 5,
    onUpdate: (update) => {
      store.save(update);
    },
  });

  assert.ok(getCallCount >= 1);
  assert.equal(finished.status, "completed");
  assert.equal(finished.activeProviderCallId, null);
  assert.equal(finished.reconciliationRequired, false);
  assert.equal(store.get(drillId)?.status, "completed");
  rmSync(dir, { recursive: true, force: true });
});

test("timeout retains provider ID plus reconciliation state and never places backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-timeout-recon-"));
  const store = new JsonDrillStore(dir);
  const drillId = "drill-timeout-recon";
  store.save(armedDrill(drillId));

  const provider: CallePort = {
    async createCall(): Promise<CallSnapshot> {
      return {
        id: "call_timeout_persist",
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
    },
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
    },
    async waitForResult(): Promise<CallSnapshot> {
      throw new Error("unused");
    },
  };

  const finished = await runDrill(store.get(drillId)!, {
    port: provider,
    perCallTimeoutMs: 40,
    pollIntervalMs: 10,
    onUpdate: (update) => {
      store.save(update);
    },
  });

  const persisted = store.get(drillId)!;
  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.attempts.length, 1);
  assert.equal(finished.activeProviderCallId, "call_timeout_persist");
  assert.equal(finished.reconciliationRequired, true);
  assert.equal(finished.reconciliationReason, "timeout");
  assert.equal(persisted.activeProviderCallId, "call_timeout_persist");
  assert.equal(persisted.reconciliationRequired, true);
  assert.equal(launchSideEffectsBlocked(persisted), true);
  assert.ok(!JSON.stringify(finished.report).includes("+15550100001"));
  rmSync(dir, { recursive: true, force: true });
});

test("crash-like getCall exception retains provider ID and blocks relaunch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-crash-recon-"));
  const store = new JsonDrillStore(dir);
  const drillId = "drill-crash-recon";
  store.save(armedDrill(drillId));

  const provider: CallePort = {
    async createCall(): Promise<CallSnapshot> {
      return {
        id: "call_crash_persist",
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
    },
    async getCall(): Promise<CallSnapshot> {
      throw new CalleApiError("upstream_timeout", "provider read failed", 408);
    },
    async waitForResult(): Promise<CallSnapshot> {
      throw new Error("unused");
    },
  };

  const finished = await runDrill(store.get(drillId)!, {
    port: provider,
    pollIntervalMs: 5,
    onUpdate: (update) => {
      store.save(update);
    },
  });

  assert.equal(finished.status, "ambiguous");
  assert.equal(finished.activeProviderCallId, "call_crash_persist");
  assert.equal(finished.reconciliationRequired, true);
  assert.equal(launchSideEffectsBlocked(finished), true);
  rmSync(dir, { recursive: true, force: true });
});

test("process-interruption style reload materializes reconciliation and never auto-retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-interrupt-"));
  const store = new JsonDrillStore(dir);
  const claims = new (await import("../src/store.js")).FileLaunchClaimStore(dir);
  const deps = { store, claims };
  service.resetServiceStateForTests();

  const drillId = "drill-interrupted-reload";
  store.save({
    ...armedDrill(drillId),
    status: "calling_primary",
    launchClaim: { idempotencyKey: "interrupt-key", claimedAt: "2026-01-01T00:00:00.000Z", claimedBy: "test" },
    activeProviderCallId: "call_orphaned_1",
    activeProviderCallRole: "primary",
    reconciliationRequired: false,
    reconciliationReason: null,
  });

  const viewed = service.getDrill(deps, drillId);
  assert.ok(viewed);
  assert.equal(viewed.status, "ambiguous");
  assert.equal(viewed.activeProviderCallId, "call_orphaned_1");
  assert.equal(viewed.reconciliationRequired, true);
  assert.equal(viewed.reconciliationReason, "interrupted");
  assert.equal(launchSideEffectsBlocked(viewed), true);

  const publicView = service.publicDrillView(viewed);
  assert.equal(publicView.primary.phone, undefined);
  assert.equal(publicView.activeProviderCallId, "call_orphaned_1");
  assert.equal(publicView.reconciliationRequired, true);
  assert.ok(!JSON.stringify(publicView).includes("+15550100001"));

  await assert.rejects(
    () => service.launchDrill(deps, drillId, { launchConfirmed: true, idempotencyKey: "new-key" }),
    /cannot be launched again|already has a launch claim/i,
  );

  service.resetServiceStateForTests();
  rmSync(dir, { recursive: true, force: true });
});

test("successful drill clears active checkpoint after safe terminal evaluation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-clear-checkpoint-"));
  const store = new JsonDrillStore(dir);
  const drillId = "drill-clear-ok";
  store.save(armedDrill(drillId));

  const snapshot = successSnapshot("call_clear_1");
  const provider: CallePort = {
    async createCall(): Promise<CallSnapshot> {
      return { ...snapshot, status: "queued", taskCompleted: null, completionConfidence: null };
    },
    async getCall(): Promise<CallSnapshot> {
      return snapshot;
    },
    async waitForResult(): Promise<CallSnapshot> {
      return snapshot;
    },
  };

  const finished = await runDrill(store.get(drillId)!, {
    port: provider,
    onUpdate: (update) => {
      store.save(update);
    },
  });

  assert.equal(finished.status, "completed");
  assert.equal(finished.activeProviderCallId, null);
  assert.equal(finished.reconciliationRequired, false);
  assert.equal(finished.reconciliationReason, null);
  rmSync(dir, { recursive: true, force: true });
});
