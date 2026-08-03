import assert from "node:assert/strict";
import test from "node:test";
import { buildScores } from "../src/scoring.js";
import type { CallAttemptRecord, DrillRecord } from "../src/types.js";

const drill = {
  id: "d",
  scenario: "production_outage",
  backup: { role: "backup", label: "B", phoneMasked: "x", consented: true },
} as DrillRecord;

test("scores are deterministic for successful primary", () => {
  const attempts: CallAttemptRecord[] = [
    {
      role: "primary",
      callId: "c1",
      phoneMasked: "+*******0001",
      status: "completed",
      outcome: "success",
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: true,
        first_action: "Open bridge",
        escalation_target: null,
        needs_help: false,
        follow_up_required: false,
        opt_out: false,
      },
      evidenceExcerpt: ["bot: drill", "user: acknowledged"],
      failureCode: null,
      ambiguous: false,
      startedAt: "t",
      completedAt: "t",
    },
  ];
  const scores = buildScores(drill, attempts);
  assert.equal(scores.contactability, 100);
  assert.equal(scores.acknowledgement, 100);
  assert.equal(scores.roleCoverage, 100);
});
