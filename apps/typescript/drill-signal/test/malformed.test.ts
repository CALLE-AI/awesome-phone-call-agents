import assert from "node:assert/strict";
import test from "node:test";
import { parseStructuredResult } from "../src/schema.js";

test("malformed structured results are rejected", () => {
  assert.equal(parseStructuredResult({ reached_live_person: true }), null);
  assert.equal(parseStructuredResult(null), null);
});

test("valid structured results parse", () => {
  const parsed = parseStructuredResult({
    reached_live_person: true,
    acknowledged_scenario: true,
    can_take_ownership: true,
    first_action: "check dashboards",
    escalation_target: null,
    needs_help: false,
    follow_up_required: false,
    opt_out: false,
  });
  assert.equal(parsed?.first_action, "check dashboards");
});
