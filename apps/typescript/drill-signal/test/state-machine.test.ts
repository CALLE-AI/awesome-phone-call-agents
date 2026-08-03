import assert from "node:assert/strict";
import test from "node:test";
import {
  canEscalateToBackup,
  classifyPrimaryOutcome,
  maxCallsForDrill,
  nextStatusAfterPrimaryEvaluation,
} from "../src/state-machine.js";
import type { DrillRecord } from "../src/types.js";

function baseDrill(overrides: Partial<DrillRecord> = {}): DrillRecord {
  return {
    id: "d1",
    scenario: "production_outage",
    status: "evaluating_primary",
    mode: "simulation",
    primary: { role: "primary", label: "Primary", phone: "+15550100001", phoneMasked: "+*******0001", consented: true },
    backup: { role: "backup", label: "Backup", phone: "+15550100003", phoneMasked: "+*******0003", consented: true },
    maxCalls: 2,
    consent: {
      primaryAttested: true,
      backupAttested: true,
      operatorConfirmedDrillPurpose: true,
      maxCallsDisclosed: true,
      liveSideEffectAcknowledged: false,
      launchConfirmed: true,
    },
    callsPlaced: 1,
    launchClaim: { idempotencyKey: "k", claimedAt: "t", claimedBy: "op" },
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
    ...overrides,
  };
}

test("max calls is 2 only when backup is consented", () => {
  const withBackup = maxCallsForDrill({
    backup: { role: "backup", label: "B", phoneMasked: "x", consented: true },
    consent: { primaryAttested: true, backupAttested: true, operatorConfirmedDrillPurpose: true, maxCallsDisclosed: true, liveSideEffectAcknowledged: false, launchConfirmed: true },
  });
  assert.equal(withBackup, 2);
  const without = maxCallsForDrill({ backup: null, consent: { primaryAttested: true, backupAttested: false, operatorConfirmedDrillPurpose: true, maxCallsDisclosed: true, liveSideEffectAcknowledged: false, launchConfirmed: true } });
  assert.equal(without, 1);
});

test("backup escalation allowed only for definitive unavailable outcomes", () => {
  const drill = baseDrill();
  assert.equal(canEscalateToBackup(drill, "no_answer"), true);
  assert.equal(canEscalateToBackup(drill, "opt_out"), true);
  assert.equal(canEscalateToBackup(drill, "success"), false);
  assert.equal(canEscalateToBackup(drill, "unknown"), false);
  assert.equal(canEscalateToBackup(drill, "timeout"), false);
  assert.equal(canEscalateToBackup(drill, "malformed_result"), false);
  assert.equal(canEscalateToBackup(drill, "api_error"), false);
});

test("classify primary success requires ownership and no opt-out", () => {
  const result = {
    reached_live_person: true,
    acknowledged_scenario: true,
    can_take_ownership: false,
    first_action: "x",
    escalation_target: null,
    needs_help: false,
    follow_up_required: false,
    opt_out: false,
  };
  assert.equal(classifyPrimaryOutcome("success", result), "refused_ownership");
});

test("next status escalates to backup when permitted", () => {
  const drill = baseDrill();
  assert.equal(nextStatusAfterPrimaryEvaluation(drill, "no_answer"), "calling_backup");
  assert.equal(nextStatusAfterPrimaryEvaluation(drill, "success"), "completed");
});
