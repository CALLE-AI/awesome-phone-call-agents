import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonDrillStore, LaunchClaimStore } from "../src/store.js";
import * as service from "../src/service.js";

function depsForTest() {
  const dir = mkdtempSync(join(tmpdir(), "drill-e2e-"));
  return {
    dir,
    deps: { store: new JsonDrillStore(dir), claims: new LaunchClaimStore(dir) },
  };
}

test("simulated product flow: create -> preview -> launch -> report", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Platform On-Call",
    primaryPhone: "+15550100001",
    primaryConsented: true,
    simulationPreset: "primary-success",
    mode: "simulation",
  });
  assert.equal(created.status, "preview_ready");
  const armed = service.acknowledgePreview(deps, created.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  assert.equal(armed.status, "armed");
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.equal(finished.status, "completed");
  assert.ok(finished.report);
  assert.equal(finished.report?.attempts.length, 1);
  assert.equal(finished.primary.phone, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("primary unavailable escalates to backup in simulation", async () => {
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
  service.acknowledgePreview(deps, created.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.attempts[0]?.role, "primary");
  assert.equal(finished.attempts[1]?.role, "backup");
  rmSync(dir, { recursive: true, force: true });
});

test("opt-out preset completes without backup when none configured", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100004",
    primaryConsented: true,
    simulationPreset: "opt-out",
    mode: "simulation",
  });
  service.acknowledgePreview(deps, created.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.equal(finished.attempts[0]?.outcome, "opt_out");
  rmSync(dir, { recursive: true, force: true });
});

test("malformed result is handled safely", async () => {
  const { dir, deps } = depsForTest();
  const created = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100005",
    primaryConsented: true,
    simulationPreset: "malformed-result",
    mode: "simulation",
  });
  service.acknowledgePreview(deps, created.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  const finished = await service.launchDrill(deps, created.id, { launchConfirmed: true });
  assert.equal(finished.attempts[0]?.outcome, "malformed_result");
  rmSync(dir, { recursive: true, force: true });
});
