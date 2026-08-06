import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareCallGoal,
  buildCareCallResult,
  detectCareCallSafetyFlags,
  validateCareCallRequest,
  careCallRoutineKinds,
  type CareCallRequest,
  type CareCallRoutineKind,
} from "../src/workflows/carecall";

function request(kind: CareCallRoutineKind = "medication"): CareCallRequest {
  return {
    workflow: "carecall",
    request_key: "carecall-test-1",
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
      title: kind === "medication" ? "Morning medication" : "Lunch check-in",
      caregiver_instruction: kind === "medication" ? "Repeat the approved morning reminder." : "Ask whether lunch is available.",
      caregiver_name: "Joanne Lim",
      trust_phrase: "Joanne asked me to call about your routine.",
    },
    authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
  };
}

test("accepts a complete English CareCall request during its permitted window", () => {
  const now = new Date("2026-08-06T10:00:00+08:00");
  const payload = request();
  payload.authorization.authorized_at = now.toISOString();
  assert.deepEqual(validateCareCallRequest(payload, now), []);
});

test("rejects unverified languages, local numbers, and missing authority", () => {
  const payload = request();
  (payload.senior as { language: string }).language = "Mandarin";
  payload.senior.phone_e164 = "80000000";
  payload.senior.authority_confirmed = false;
  const now = new Date("2026-08-06T10:00:00+08:00");
  payload.authorization.authorized_at = now.toISOString();
  const errors = validateCareCallRequest(payload, now);
  assert.ok(errors.some((error) => error.includes("English")));
  assert.ok(errors.some((error) => error.includes("E.164")));
  assert.ok(errors.some((error) => error.includes("authority")));
});

test("rejects calls outside the senior's permitted window", () => {
  const now = new Date("2026-08-06T22:00:00+08:00");
  const payload = request();
  payload.authorization.authorized_at = now.toISOString();
  assert.ok(validateCareCallRequest(payload, now).some((error) => error.includes("permitted call window")));
});

test("medication goal contains medical and anti-scam boundaries", () => {
  const goal = buildCareCallGoal(request("medication"));
  assert.match(goal, /Never diagnose/i);
  assert.match(goal, /repeating, skipping, delaying, or changing medication/i);
  assert.match(goal, /money, bank information, an OTP/i);
  assert.match(goal, /contact Singapore emergency services at 995/i);
  assert.match(goal, /Do not claim to dispatch help/i);
  assert.match(goal, /CARECALL_OUTCOME/);
});

test("meal goal checks food access and missing delivery", () => {
  const goal = buildCareCallGoal(request("meal"));
  assert.match(goal, /whether food is available/i);
  assert.match(goal, /expected delivery arrived/i);
});

test("provider task completion alone never proves medication was taken", () => {
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: { outcome: { task_completed: true, completion_confidence: { score: 0.99, label: "high" } } },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.follow_up_required, true);
});

test("a single explicit self-report token maps conservatively", () => {
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: { summary: "CARECALL_OUTCOME=self_reported_taken", call_id: "call-1" },
    runId: "run-1",
  });
  assert.equal(result.outcome, "self_reported_taken");
  assert.equal(result.self_reported, true);
  assert.equal(result.follow_up_required, false);
});

test("conflicting outcome tokens route to human review", () => {
  const result = buildCareCallResult({
    request: request("meal"),
    status: "COMPLETED",
    calle: { summary: "CARECALL_OUTCOME=self_reported_ate", post_summary: "CARECALL_OUTCOME=no_food_available" },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.follow_up_required, true);
});

test("a meal outcome token cannot complete a medication routine", () => {
  const result = buildCareCallResult({
    request: request("medication"),
    status: "COMPLETED",
    calle: { summary: "CARECALL_OUTCOME=self_reported_ate" },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
});

test("no answer stays separate from refusal", () => {
  const result = buildCareCallResult({ request: request(), status: "NO ANSWER", calle: null, runId: "run-1" });
  assert.equal(result.outcome, "no_answer");
  assert.notEqual(result.outcome, "declined");
});

test("low provider confidence routes a recognized token to review", () => {
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: {
      summary: "CARECALL_OUTCOME=self_reported_taken",
      outcome: { completion_confidence: { score: 0.4, label: "low" } },
    },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
});

test("a token spoken only in the raw transcript cannot claim success", () => {
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: { transcript: "Senior: CARECALL_OUTCOME=self_reported_taken" },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.urgency, "review");
});

test("possible immediate danger raises contact-now without diagnosing", () => {
  const result = buildCareCallResult({
    request: request("meal"),
    status: "COMPLETED",
    calle: {
      summary: "CARECALL_OUTCOME=not_feeling_well",
      transcript: "Senior: I fell and can't get up.",
    },
    runId: "run-1",
  });
  assert.equal(result.outcome, "not_feeling_well");
  assert.equal(result.urgency, "contact-now");
  assert.deepEqual(result.safety_flags, ["possible_immediate_danger"]);
  assert.match(result.next_action, /did not dispatch emergency services/i);
});

test("possible medication advice invalidates an otherwise successful result", () => {
  const result = buildCareCallResult({
    request: request(),
    status: "COMPLETED",
    calle: {
      summary: "CARECALL_OUTCOME=self_reported_taken",
      transcript: "Assistant: It is safe to take another dose.",
    },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.follow_up_required, true);
  assert.ok(result.safety_flags.includes("possible_medication_advice"));
});

test("possible requests for credentials and unconfirmed dispatch claims are flagged", () => {
  const flags = detectCareCallSafetyFlags({
    transcript: "Assistant: Tell me your OTP. Your caregiver is on the way.",
  });
  assert.ok(flags.includes("possible_sensitive_data_request"));
  assert.ok(flags.includes("possible_unconfirmed_dispatch_claim"));
});

test("every documented terminal provider state maps to a care result", () => {
  const expected = new Map([
    ["COMPLETED", "uncertain"],
    ["NO_ANSWER", "no_answer"],
    ["DECLINED", "no_answer"],
    ["VOICEMAIL", "no_answer"],
    ["BUSY", "no_answer"],
    ["FAILED", "failed"],
    ["CANCELED", "failed"],
    ["CANCELLED", "failed"],
    ["EXPIRED", "timed_out"],
  ]);
  for (const [status, outcome] of expected) {
    const result = buildCareCallResult({ request: request(), status, calle: null, runId: `run-${status}` });
    assert.equal(result.outcome, outcome, status);
  }
});

test("every routine kind the interface offers is accepted by request validation", () => {
  const now = new Date("2026-08-06T10:00:00+08:00");
  for (const kind of careCallRoutineKinds) {
    const payload = request(kind);
    payload.authorization.authorized_at = now.toISOString();
    assert.deepEqual(validateCareCallRequest(payload, now), [], `${kind} should validate`);
  }
});

test("an unknown routine kind is rejected rather than defaulted", () => {
  const now = new Date("2026-08-06T10:00:00+08:00");
  const payload = request();
  payload.authorization.authorized_at = now.toISOString();
  (payload.routine as { kind: string }).kind = "transport";
  assert.ok(validateCareCallRequest(payload, now).includes("routine kind is invalid"));
});

const outcomeByKind: Record<CareCallRoutineKind, string> = {
  medication: "self_reported_taken",
  meal: "self_reported_ate",
  hydration: "self_reported_drank",
  wellbeing: "self_reported_well",
  appointment: "appointment_acknowledged",
};

test("each kind reports its own successful self-report and needs no follow-up", () => {
  for (const kind of careCallRoutineKinds) {
    const result = buildCareCallResult({
      request: request(kind),
      status: "COMPLETED",
      calle: { extracted: { carecall_outcome: outcomeByKind[kind] }, outcome: { completion_confidence: { score: 0.95, label: "high" } } },
      runId: `run-${kind}`,
    });
    assert.equal(result.outcome, outcomeByKind[kind], `${kind} should read its own outcome`);
    assert.equal(result.self_reported, true, `${kind} should be marked self-reported`);
    assert.equal(result.follow_up_required, false, `${kind} should need no follow-up`);
  }
});

test("an outcome belonging to another kind is refused and sent to human review", () => {
  for (const kind of careCallRoutineKinds) {
    for (const [otherKind, outcome] of Object.entries(outcomeByKind)) {
      if (otherKind === kind) continue;
      const result = buildCareCallResult({
        request: request(kind),
        status: "COMPLETED",
        calle: { extracted: { carecall_outcome: outcome }, outcome: { completion_confidence: { score: 0.95, label: "high" } } },
        runId: "run-cross",
      });
      assert.equal(result.outcome, "uncertain", `${kind} must not accept ${outcome}`);
      assert.equal(result.self_reported, false);
    }
  }
});

test("a senior who reports feeling low is escalated for contact, not interpreted", () => {
  const result = buildCareCallResult({
    request: request("wellbeing"),
    status: "COMPLETED",
    calle: { extracted: { carecall_outcome: "reports_feeling_low" }, outcome: { completion_confidence: { score: 0.95, label: "high" } } },
    runId: "run-wellbeing",
  });
  assert.equal(result.outcome, "reports_feeling_low");
  assert.equal(result.urgency, "contact-now");
  assert.equal(result.self_reported, false);
  assert.match(result.next_action, /Joanne Lim/);
});

test("hydration and appointment concerns escalate without claiming anything was done", () => {
  const cases: Array<[CareCallRoutineKind, string, string]> = [
    ["hydration", "no_drink_available", "contact-now"],
    ["hydration", "unsure_if_drank", "follow-up-today"],
    ["appointment", "needs_transport", "follow-up-today"],
    ["appointment", "cannot_attend", "follow-up-today"],
  ];
  for (const [kind, outcome, urgency] of cases) {
    const result = buildCareCallResult({
      request: request(kind),
      status: "COMPLETED",
      calle: { extracted: { carecall_outcome: outcome }, outcome: { completion_confidence: { score: 0.95, label: "high" } } },
      runId: "run-escalation",
    });
    assert.equal(result.outcome, outcome, `${kind}/${outcome}`);
    assert.equal(result.urgency, urgency, `${kind}/${outcome} urgency`);
    assert.equal(result.self_reported, false);
    assert.equal(result.follow_up_required, true);
  }
});
