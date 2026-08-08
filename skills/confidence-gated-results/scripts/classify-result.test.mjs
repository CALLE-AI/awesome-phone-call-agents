import assert from "node:assert/strict";
import test from "node:test";

import {
  classify,
  buildRepairPlan,
  mergeResults,
  missingFields,
  findContradictions,
  isSensitiveField,
  COMMIT,
  REPAIR,
  ESCALATE,
} from "../scripts/classify-result.mjs";

const REQUIRED = ["appointment_confirmed", "preferred_date"];

const completed = (structured_result, duration_seconds = 90) => ({
  id: "call_a1",
  status: "completed",
  duration_seconds,
  structured_result,
});

test("a complete result commits", () => {
  const d = classify(completed({ appointment_confirmed: true, preferred_date: "2026-08-14" }), {
    required: REQUIRED,
  });
  assert.equal(d.tier, COMMIT);
  assert.deepEqual(d.missing, []);
});

test("null after a real conversation is a repair, not a no", () => {
  const d = classify(completed(null, 96), { required: REQUIRED, turnCount: 14 });
  assert.equal(d.tier, REPAIR);
  assert.deepEqual(d.missing, REQUIRED);
});

test("null after a five second hangup is NOT repaired", () => {
  const d = classify(completed(null, 5), { required: REQUIRED, turnCount: 1 });
  assert.equal(d.tier, ESCALATE);
  assert.equal(d.reason, "conversation_too_short_to_repair");
});

test("the same null gets opposite decisions based on the event stream", () => {
  const call = completed(null, 5);
  const hangup = classify(call, { required: REQUIRED, turnCount: 1 });
  const real = classify({ ...call, duration_seconds: 96 }, { required: REQUIRED, turnCount: 14 });
  assert.equal(hangup.tier, ESCALATE);
  assert.equal(real.tier, REPAIR);
});

test("a partial result repairs only the missing field", () => {
  const d = classify(
    completed({ appointment_confirmed: true, preferred_date: "" }, 74),
    { required: REQUIRED, turnCount: 9 },
  );
  assert.equal(d.tier, REPAIR);
  assert.deepEqual(d.missing, ["preferred_date"], "a captured field must never be re-asked");
});

test("a contradictory result escalates and is never repaired", () => {
  const d = classify(
    completed({ order_confirmed: true, cancel_requested: true }, 112),
    { required: ["order_confirmed"], exclusivePairs: [["order_confirmed", "cancel_requested"]], turnCount: 20 },
  );
  assert.equal(d.tier, ESCALATE);
  assert.equal(d.reason, "contradictory_result");
});

test("a missing sensitive field escalates instead of calling back", () => {
  const d = classify(completed({}, 90), { required: ["card_number"], turnCount: 12 });
  assert.equal(d.tier, ESCALATE);
  assert.equal(d.reason, "sensitive_field_missing");
});

test("only one repair call is ever permitted", () => {
  const d = classify(completed(null, 96), { required: REQUIRED, turnCount: 14, repairAlreadyPlaced: true });
  assert.equal(d.tier, ESCALATE);
  assert.equal(d.reason, "repair_already_attempted");
});

test("an unanswered call is a reachability problem, not a confidence problem", () => {
  const d = classify({ status: "no_answer", duration_seconds: 0 }, { required: REQUIRED });
  assert.equal(d.tier, ESCALATE);
  assert.match(d.reason, /^not_answered:/);
});

test("non-blocking fields are dropped rather than chased", () => {
  const d = classify(
    completed({ appointment_confirmed: true, preferred_date: "2026-08-14", contact_email: "" }, 90),
    { required: [...REQUIRED, "contact_email"], blocking: REQUIRED, turnCount: 12 },
  );
  assert.equal(d.tier, COMMIT);
  assert.deepEqual(d.missing, ["contact_email"]);
});

test("the repair schema is a strict subset and never widens the ask", () => {
  const call = completed({ appointment_confirmed: true }, 90);
  const d = classify(call, { required: REQUIRED, turnCount: 12 });
  const plan = buildRepairPlan(call, d, { originalCallId: "call_a1" });
  assert.deepEqual(plan.schema.required, ["preferred_date"]);
  assert.ok(plan.schema.required.every((f) => REQUIRED.includes(f)));
  assert.ok(plan.schema.required.length < REQUIRED.length);
});

test("the repair call carries a stable idempotency key derived from the original", () => {
  const call = completed(null, 96);
  const d = classify(call, { required: REQUIRED, turnCount: 14 });
  assert.equal(buildRepairPlan(call, d, { originalCallId: "call_a1" }).idempotencyKey, "repair:call_a1");
});

test("the repair task references the earlier call so the person is not confused", () => {
  const call = completed(null, 96);
  const d = classify(call, { required: REQUIRED, turnCount: 14 });
  assert.match(buildRepairPlan(call, d, { originalCallId: "call_a1" }).task, /we spoke a moment ago/);
});

test("a repair plan cannot be built from a non-repair decision", () => {
  const call = completed({ appointment_confirmed: true, preferred_date: "2026-08-14" });
  const d = classify(call, { required: REQUIRED });
  assert.throws(() => buildRepairPlan(call, d, { originalCallId: "call_a1" }), /requires a REPAIR/);
});

test("merging records which call each field came from", () => {
  const merged = mergeResults({
    original: { appointment_confirmed: true },
    repair: { preferred_date: "2026-08-14" },
    originalCallId: "call_a1",
    repairCallId: "call_a2",
    required: REQUIRED,
  });
  assert.equal(merged.appointment_confirmed.from, "call_a1");
  assert.equal(merged.preferred_date.from, "call_a2");
  assert.equal(merged.preferred_date.value, "2026-08-14");
});

test("empty strings and empty arrays count as missing", () => {
  assert.deepEqual(missingFields({ a: "", b: [], c: "ok" }, ["a", "b", "c"]), ["a", "b"]);
});

test("false is a real answer and is not missing", () => {
  assert.deepEqual(missingFields({ confirmed: false }, ["confirmed"]), []);
});

test("sensitive field detection is substring based", () => {
  assert.ok(isSensitiveField("customer_card_number"));
  assert.ok(isSensitiveField("OTP"));
  assert.equal(isSensitiveField("preferred_date"), false);
});

test("contradiction detection only fires when both are true", () => {
  const pairs = [["a", "b"]];
  assert.deepEqual(findContradictions({ a: true, b: false }, pairs), []);
  assert.equal(findContradictions({ a: true, b: true }, pairs).length, 1);
});
