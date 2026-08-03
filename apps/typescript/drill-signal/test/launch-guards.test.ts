import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigError } from "../src/config.js";
import { launchSideEffectsBlocked } from "../src/state-machine.js";
import { FileLaunchClaimStore, JsonDrillStore } from "../src/store.js";
import * as service from "../src/service.js";
import { runDrill } from "../src/orchestrator.js";
import { presetScenarios, SimulationProvider } from "../src/provider/simulation.js";
import type { DrillRecord } from "../src/types.js";

function depsForTest() {
  const dir = mkdtempSync(join(tmpdir(), "drill-guards-"));
  return {
    dir,
    deps: { store: new JsonDrillStore(dir), claims: new FileLaunchClaimStore(dir) },
  };
}

function armDrill(deps: ReturnType<typeof depsForTest>["deps"], drill: DrillRecord): DrillRecord {
  return service.acknowledgePreview(deps, drill.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
}

test("launch claim store uses atomic wx creation", () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-claim-atomic-"));
  const store = new FileLaunchClaimStore(dir);
  assert.equal(store.tryClaim("drill-1", "key-a"), "new");
  assert.equal(store.tryClaim("drill-1", "key-a"), "replay");
  assert.equal(store.tryClaim("drill-1", "key-b"), "conflict");
  rmSync(dir, { recursive: true, force: true });
});

test("launch before armed is rejected", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
  });
  await assert.rejects(
    () => service.launchDrill(deps, created.id, { launchConfirmed: true }),
    (error: unknown) => error instanceof ConfigError && /armed/i.test((error as Error).message),
  );
  rmSync(dir, { recursive: true, force: true });
});

test("launch without preview attestations is rejected even if status were armed", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
  });
  const armed = armDrill(deps, created);
  const tampered = deps.store.save({
    ...armed,
    consent: { ...armed.consent, operatorConfirmedDrillPurpose: false },
  });
  assert.equal(tampered.status, "armed");
  await assert.rejects(
    () => service.launchDrill(deps, tampered.id, { launchConfirmed: true }),
    (error: unknown) => error instanceof ConfigError && /preview consent/i.test((error as Error).message),
  );
  rmSync(dir, { recursive: true, force: true });
});

test("launch cannot escalate simulation to live", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    mode: "simulation",
  });
  armDrill(deps, created);
  await assert.rejects(
    () => service.launchDrill(deps, created.id, { launchConfirmed: true, mode: "live" }),
    (error: unknown) => error instanceof ConfigError && /cannot change mode/i.test((error as Error).message),
  );
  rmSync(dir, { recursive: true, force: true });
});

test("terminal drill cannot be relaunched", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  armDrill(deps, created);
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.equal(finished.status, "completed");
  await assert.rejects(
    () => service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: "new-attempt-key" }),
    (error: unknown) => error instanceof ConfigError,
  );
  const after = service.getDrill(deps, created.id);
  assert.equal(after?.attempts.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("same idempotency key replay is read-only", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  armDrill(deps, created);
  const key = "replay-key-1";
  const first = await service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: key });
  const second = await service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: key });
  assert.equal(second.status, first.status);
  assert.equal(second.attempts.length, first.attempts.length);
  rmSync(dir, { recursive: true, force: true });
});

test("different idempotency key is blocked after launch claim", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  armDrill(deps, created);
  await service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: "key-a" });
  await assert.rejects(
    () => service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: "key-b" }),
    (error: unknown) => error instanceof ConfigError,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("concurrent parallel launches place only one provider execution", async () => {
  const { dir, deps } = depsForTest();
  SimulationProvider.createCallCount = 0;

  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  armDrill(deps, created);

  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      service.launchDrill(deps, created.id, { launchConfirmed: true, idempotencyKey: "parallel-key" }),
    ),
  );
  assert.equal(SimulationProvider.createCallCount, 1, "only one provider createCall should run");
  for (const result of results) {
    assert.ok(result.attempts.length <= 1);
    assert.ok(result.callsPlaced <= result.maxCalls);
    assert.equal(result.status, "completed");
  }
  service.resetServiceStateForTests();
  rmSync(dir, { recursive: true, force: true });
});

test("cancel before backup escalation is observed after primary failure", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100002",
    primaryConsented: true,
    backupLabel: "Backup",
    backupPhone: "+15550100003",
    backupConsented: true,
    simulationPreset: "primary-unavailable-backup-success",
    mode: "simulation",
  });
  const armed = armDrill(deps, created);
  let cancelBeforeBackup = false;
  const finished = await runDrill(
    {
      ...armed,
      consent: { ...armed.consent, launchConfirmed: true },
      launchClaim: { idempotencyKey: "cancel-before-backup", claimedAt: new Date().toISOString(), claimedBy: "test" },
    },
    {
      port: new SimulationProvider(presetScenarios("primary-unavailable-backup-success")),
      context: {
        signal: new AbortController().signal,
        isCancelled: () => cancelBeforeBackup,
      },
      onUpdate: (update) => {
        if (update.status === "evaluating_primary" && update.attempts.length >= 1) {
          cancelBeforeBackup = true;
        }
      },
    },
  );
  assert.equal(finished.status, "cancelled");
  assert.equal(finished.attempts.filter((attempt) => attempt.role === "backup").length, 0);
  assert.ok(finished.callsPlaced <= finished.maxCalls);
  rmSync(dir, { recursive: true, force: true });
});

test("cancel during primary wait prevents backup escalation", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100006",
    primaryConsented: true,
    backupLabel: "Backup",
    backupPhone: "+15550100003",
    backupConsented: true,
    simulationPreset: "timeout-unknown",
    mode: "simulation",
  });
  armDrill(deps, created);
  const launchPromise = service.launchDrill(deps, created.id, { launchConfirmed: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  service.cancelDrill(deps, created.id);
  const finished = await launchPromise;
  assert.equal(finished.status, "cancelled");
  assert.ok(finished.callsPlaced <= 1);
  assert.equal(finished.attempts.filter((a) => a.role === "backup").length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("launch side effects blocked covers terminal and in-flight states", () => {
  const base = {
    status: "armed",
    id: "x",
    scenario: "production_outage",
    mode: "simulation",
    primary: { role: "primary", label: "P", phoneMasked: "m", consented: true },
    backup: null,
    maxCalls: 1,
    consent: {
      primaryAttested: true,
      backupAttested: false,
      operatorConfirmedDrillPurpose: true,
      maxCallsDisclosed: true,
      liveSideEffectAcknowledged: false,
      launchConfirmed: false,
    },
    callsPlaced: 0,
    launchClaim: null,
    simulationPreset: "primary-success",
    events: [],
    attempts: [],
    report: null,
    cancelRequested: false,
    cancelBoundary: null,
    activeProviderCallId: null,
    activeProviderCallRole: null,
    reconciliationRequired: false,
    reconciliationReason: null,
    createdAt: "t",
    updatedAt: "t",
  } as DrillRecord;

  assert.equal(launchSideEffectsBlocked({ ...base, status: "completed" }), true);
  assert.equal(launchSideEffectsBlocked({ ...base, status: "calling_primary" }), true);
  assert.equal(launchSideEffectsBlocked({ ...base, status: "armed", launchClaim: { idempotencyKey: "k", claimedAt: "t", claimedBy: "op" } }), true);
  assert.equal(launchSideEffectsBlocked({ ...base, status: "armed" }), false);
  assert.equal(
    launchSideEffectsBlocked({
      ...base,
      status: "armed",
      activeProviderCallId: "call_orphan_1",
      activeProviderCallRole: "primary",
    }),
    true,
  );
  assert.equal(
    launchSideEffectsBlocked({
      ...base,
      status: "armed",
      reconciliationRequired: true,
      reconciliationReason: "interrupted",
    }),
    true,
  );
});

test("simulation report includes fictional evidence excerpts", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  armDrill(deps, created);
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.ok(finished.report);
  assert.ok(finished.report!.evidence.length > 0);
  assert.match(finished.report!.evidence[0]!, /bot:|user:/i);
  rmSync(dir, { recursive: true, force: true });
});

test("live provider is not constructed when launch gates fail", async () => {
  const { dir, deps } = depsForTest();
  SimulationProvider.createCallCount = 0;
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    mode: "live",
  });
  await assert.rejects(
    () => service.launchDrill(deps, created.id, { launchConfirmed: true }),
    (error: unknown) => error instanceof ConfigError,
  );
  assert.equal(SimulationProvider.createCallCount, 0);
  rmSync(dir, { recursive: true, force: true });
});
