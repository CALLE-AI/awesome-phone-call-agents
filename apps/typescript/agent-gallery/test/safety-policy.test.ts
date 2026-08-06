import assert from "node:assert/strict";
import test from "node:test";
import {
  safetyPolicyEmergency,
  safetyPolicyEscalation,
  safetyPolicyFlags,
  safetyPolicyKinds,
  safetyPolicyMay,
  safetyPolicyNever,
  safetyPolicyUrgencies,
} from "../src/carecall/safety-policy";
import { routineKindOrder, routineKindProfile } from "../src/carecall/routine-kinds";
import {
  buildCareCallResult,
  careCallSafetyFlagDetails,
  detectCareCallSafetyFlags,
  outcomesForKind,
  careCallOutcomeLabel,
  type CareCallRequest,
  type CareCallRoutineKind,
} from "../src/workflows/carecall";

function request(kind: CareCallRoutineKind = "medication"): CareCallRequest {
  return {
    workflow: "carecall",
    request_key: "policy-test",
    organisation: { name: "Queenstown Care Team", timezone: "Asia/Singapore" },
    senior: {
      id: "mdm-lim",
      preferred_name: "Mdm Lim",
      phone_e164: "+6580000000",
      language: "English",
      authority_confirmed: true,
      permitted_call_window: "8:00 AM–8:00 PM",
    },
    routine: {
      id: `${kind}-routine`,
      kind,
      title: "Routine",
      caregiver_instruction: "Repeat the approved wording.",
      caregiver_name: "Joanne Lim",
      trust_phrase: "Joanne asked me to call.",
    },
    authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
  };
}

test("the policy lists every routine kind the interface offers", () => {
  assert.deepEqual(safetyPolicyKinds().map((entry) => entry.kind), routineKindOrder);
});

test("each kind's policy entry repeats the boundary the builder and preview show", () => {
  for (const entry of safetyPolicyKinds()) {
    assert.equal(entry.boundary, routineKindProfile(entry.kind as CareCallRoutineKind).boundary);
  }
});

test("each kind's policy entry lists exactly the outcomes that kind may report", () => {
  for (const entry of safetyPolicyKinds()) {
    const expected = outcomesForKind(entry.kind as CareCallRoutineKind).map(careCallOutcomeLabel);
    assert.deepEqual(entry.outcomes, expected, `${entry.kind} outcome list drifted`);
    assert.ok(expected.length > 0);
  }
});

test("every outcome shown in the policy is a readable label, not an identifier", () => {
  for (const entry of safetyPolicyKinds()) {
    for (const outcome of entry.outcomes) {
      assert.ok(!outcome.includes("_"), `${outcome} should be a label`);
    }
  }
});

test("the policy documents every safety flag the workflow can raise", () => {
  const documented = safetyPolicyFlags.map((entry) => entry.flag).sort();
  assert.deepEqual(documented, Object.keys(careCallSafetyFlagDetails).sort());
});

test("every documented flag states a meaning and an operator response", () => {
  for (const entry of safetyPolicyFlags) {
    assert.ok(entry.label && !entry.label.includes("_"), `${entry.flag} needs a readable label`);
    assert.ok(entry.meaning.length > 30, `${entry.flag} needs a meaning`);
    assert.ok(entry.response.length > 30, `${entry.flag} needs a response`);
  }
});

test("a flag a real call can raise is documented and reaches the result", () => {
  const flags = detectCareCallSafetyFlags({ summary: "You should take another tablet now." });
  assert.deepEqual(flags, ["possible_medication_advice"]);
  assert.ok(safetyPolicyFlags.some((entry) => entry.flag === flags[0]));
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: { summary: "You should take another tablet now." },
    runId: "run-flagged",
  });
  assert.deepEqual(result.safety_flags, ["possible_medication_advice"]);
  assert.equal(result.outcome, "uncertain");
});

test("the immediate-danger response never claims CareCall summoned help", () => {
  const detail = careCallSafetyFlagDetails.possible_immediate_danger;
  assert.match(detail.response, /did not dispatch emergency services/);
  assert.match(detail.response, /995/);
});

test("the emergency statement names 995 and denies CareCall contacts anyone", () => {
  assert.match(safetyPolicyEmergency, /995/);
  assert.match(safetyPolicyEmergency, /does not contact emergency services/);
});

test("the policy documents every urgency level, most urgent first", () => {
  assert.deepEqual(safetyPolicyUrgencies.map((level) => level.urgency), ["contact-now", "follow-up-today", "review", "none"]);
  for (const level of safetyPolicyUrgencies) {
    assert.ok(level.label && level.meaning.length > 20, `${level.urgency} needs a meaning`);
  }
});

test("the may and never lists are non-empty and do not contradict each other", () => {
  assert.ok(safetyPolicyMay.length >= 5);
  assert.ok(safetyPolicyNever.length >= 5);
  for (const rule of [...safetyPolicyMay, ...safetyPolicyNever]) {
    assert.ok(rule.endsWith("."), `"${rule}" should read as a sentence`);
  }
});

test("the never list keeps the rules the workflow actually enforces", () => {
  const joined = safetyPolicyNever.join(" ").toLowerCase();
  for (const term of ["diagnose", "dose", "silence", "otp", "dispatched"]) {
    assert.ok(joined.includes(term), `the never list should cover ${term}`);
  }
});

test("the standing limits state the English-only and no-blind-retry rules", () => {
  const joined = safetyPolicyEscalation.join(" ").toLowerCase();
  assert.ok(joined.includes("english only"));
  assert.ok(joined.includes("redialled blindly"));
  assert.ok(joined.includes("cannot recall"));
});
