// No-call unit tests for the enforced safety gates. NONE of these place a call:
// interpretAck is pure; runEscalation runs in dry-run or with an injected `_placeCall`
// stub, so the `calle` CLI is never spawned.
// Run: node --test --experimental-strip-types scripts/run_escalation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpretAck,
  isValidE164,
  liveCallAllowed,
  idempotencyKey,
  runEscalation,
  type Alert,
  type Contact,
  type AckResult,
} from "./run_escalation.ts";

const ALERT: Alert = { id: "alert-1", title: "Athlete flagged RED", detail: "HRV 33", recommendation: "hold" };
const DISCLOSURE = "This is an automated readiness assistant calling on behalf of Example Org.";
const okOutcome = { task_completed: true, completion_confidence: { label: "high", score: 0.84 }, evidence: "Trainer said: I'll hold him for recovery." };

function baseOpts(over: Partial<Parameters<typeof runEscalation>[0]> = {}) {
  return {
    alert: ALERT,
    contactChain: [{ role: "trainer", phone_e164: "+15550101234", order: 1 }] as Contact[],
    disclosure: DISCLOSURE,
    isAllowlisted: () => true,
    isAlertResolved: () => false,
    notifyOwner: () => {},
    confirmLiveCall: true,
    env: { CALLE_LIVE: "1" } as NodeJS.ProcessEnv, // live enabled for loop tests; _placeCall stubs the dial
    ...over,
  };
}

// ---------------- Gate 6 — authoritative ack only ----------------
test("gate6: task_completed + high confidence + evidence → acknowledged", () => {
  const r = interpretAck("COMPLETED", { summary: "Got it.", outcome: okOutcome }, "trainer");
  assert.equal(r.acknowledged, true);
  assert.equal(r.reached, true);
});

test("gate6: bare acknowledged:true is NOT sufficient", () => {
  const r = interpretAck("COMPLETED", { acknowledged: true, reached: true, summary: "sounds ok" }, "trainer");
  assert.equal(r.acknowledged, false);
});

test("gate6: task_completed + high confidence but NO evidence → NOT acknowledged", () => {
  const r = interpretAck("COMPLETED", { summary: "ok", outcome: { task_completed: true, completion_confidence: { label: "high", score: 0.9 } } }, "trainer");
  assert.equal(r.acknowledged, false);
});

test("gate6: task_completed=false (even with evidence + confidence) → NOT acknowledged", () => {
  const r = interpretAck("COMPLETED", { outcome: { task_completed: false, completion_confidence: { score: 0.95 }, evidence: "said maybe later" } }, "trainer");
  assert.equal(r.acknowledged, false);
});

test("gate6: low confidence → NOT acknowledged (fail toward escalation)", () => {
  const r = interpretAck("COMPLETED", { outcome: { task_completed: true, completion_confidence: { label: "low", score: 0.3 }, evidence: "unclear" } }, "trainer");
  assert.equal(r.acknowledged, false);
});

test("gate6: no answer / voicemail / busy / declined → NOT acknowledged", () => {
  for (const s of ["NO_ANSWER", "VOICEMAIL", "BUSY", "DECLINED"]) {
    assert.equal(interpretAck(s, {}, "trainer").acknowledged, false);
  }
});

test("gate6: explicit acknowledged=false is respected", () => {
  const r = interpretAck("COMPLETED", { acknowledged: false, reached: true, summary: "Refused." }, "physician");
  assert.equal(r.acknowledged, false);
});

test("gate6: unavailable (CALL-E not reachable) → NOT acknowledged", () => {
  assert.equal(interpretAck("unavailable", { note: "CALL-E not available" }, "trainer").acknowledged, false);
});

// ---------------- Gate 1 — E.164 validation ----------------
test("gate1: isValidE164 accepts well-formed numbers", () => {
  for (const p of ["+15550101234", "+447911123456", "+81312345678"]) assert.equal(isValidE164(p), true);
});

test("gate1: isValidE164 rejects malformed numbers", () => {
  for (const p of ["5550101234", "+0123456789", "+1", "+1-555-010-1234", "+15550101234x", "", "  ", "tel:+15550101234", null as any, undefined as any]) {
    assert.equal(isValidE164(p), false, `expected reject: ${String(p)}`);
  }
});

test("gate1: runEscalation blocks a non-E.164 number and never dials it", async () => {
  let dialed = 0;
  const res = await runEscalation(baseOpts({
    contactChain: [{ role: "trainer", phone_e164: "5550101234", order: 1 }],
    _placeCall: async () => { dialed++; return {} as AckResult; },
  }));
  assert.equal(dialed, 0);
  assert.equal(res.attempts[0].blocked, true);
  assert.match(res.attempts[0].notes, /not a valid E\.164/);
});

// ---------------- Gate 2 — live-enable + confirmation ----------------
test("gate2: liveCallAllowed requires BOTH env opt-in AND confirmation", () => {
  assert.equal(liveCallAllowed({ CALLE_LIVE: "1" }, true), true);
  assert.equal(liveCallAllowed({ CALLE_LIVE: "1" }, false), false);
  assert.equal(liveCallAllowed({}, true), false);
  assert.equal(liveCallAllowed({ CALLE_LIVE: "0" }, true), false);
  assert.equal(liveCallAllowed({}, false), false);
});

test("gate2: default is dry-run — no env, no confirm → nothing dialed (real placeCall, no spawn)", async () => {
  // Uses the REAL placeCall (no _placeCall stub). With live disabled it short-circuits
  // to a dry-run BEFORE spawning the calle CLI, so this test places no call.
  const res = await runEscalation({
    alert: ALERT,
    contactChain: [{ role: "trainer", phone_e164: "+15550101234", order: 1 }],
    disclosure: DISCLOSURE,
    isAllowlisted: () => true,
    isAlertResolved: () => false,
    notifyOwner: () => { throw new Error("dry-run must not notify owner"); },
    // no confirmLiveCall, no env → dry-run
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(res.outcome, "dry_run");
  assert.equal(res.attempts[0].dry_run, true);
  assert.ok(res.attempts[0].idempotency_key);
});

test("gate2: env set but confirm missing → still dry-run", async () => {
  const res = await runEscalation({
    alert: ALERT,
    contactChain: [{ role: "trainer", phone_e164: "+15550101234", order: 1 }],
    disclosure: DISCLOSURE,
    isAllowlisted: () => true,
    isAlertResolved: () => false,
    notifyOwner: () => {},
    env: { CALLE_LIVE: "1" } as NodeJS.ProcessEnv,
    confirmLiveCall: false,
  });
  assert.equal(res.outcome, "dry_run");
  assert.equal(res.attempts[0].dry_run, true);
});

// ---------------- Gate 3 — stable idempotency ----------------
test("gate3: idempotencyKey is deterministic for the same inputs", () => {
  assert.equal(idempotencyKey("alert-1", "+15550101234", 1), idempotencyKey("alert-1", "+15550101234", 1));
});

test("gate3: idempotencyKey differs by alert, contact, and attempt", () => {
  const a = idempotencyKey("alert-1", "+15550101234", 1);
  assert.notEqual(a, idempotencyKey("alert-2", "+15550101234", 1));
  assert.notEqual(a, idempotencyKey("alert-1", "+15550105678", 1));
  assert.notEqual(a, idempotencyKey("alert-1", "+15550101234", 2));
});

// ---------------- Gate 4 — ambiguous-leg reconciliation ----------------
test("gate4: an unresolved-ambiguous leg STOPS the chain (does not advance) and flags", async () => {
  let dialed = 0;
  let notified = 0;
  const res = await runEscalation(baseOpts({
    contactChain: [
      { role: "trainer", phone_e164: "+15550101234", order: 1 },
      { role: "physician", phone_e164: "+15550105678", order: 2 },
    ],
    notifyOwner: () => { notified++; },
    _placeCall: async (_a, c) => {
      dialed++;
      return { reached: false, acknowledged: false, responder_role: c.role, action_taken: "", ambiguous: true, resolved: false, notes: "never terminal" };
    },
  }));
  assert.equal(res.outcome, "unresolved");
  assert.equal(dialed, 1, "must NOT advance to the second contact");
  assert.equal(notified, 1, "must flag the owner");
});

// ---------------- Gate 5 — between-legs alert-status check ----------------
test("gate5: alert already resolved out-of-band → halts before dialing", async () => {
  let dialed = 0;
  const res = await runEscalation(baseOpts({
    isAlertResolved: () => true,
    _placeCall: async () => { dialed++; return {} as AckResult; },
  }));
  assert.equal(res.outcome, "already_resolved");
  assert.equal(dialed, 0);
});

test("gate5: resolved BETWEEN legs stops the chain mid-way", async () => {
  let dialed = 0;
  const resolvedAfter = { n: 0 };
  const res = await runEscalation(baseOpts({
    contactChain: [
      { role: "trainer", phone_e164: "+15550101234", order: 1 },
      { role: "physician", phone_e164: "+15550105678", order: 2 },
    ],
    isAlertResolved: () => { const done = resolvedAfter.n >= 1; resolvedAfter.n++; return done; }, // resolves before leg 2
    _placeCall: async (_a, c) => { dialed++; return { reached: true, acknowledged: false, responder_role: c.role, action_taken: "", notes: "no ack" }; },
  }));
  assert.equal(dialed, 1, "second leg must be skipped once the alert is resolved");
  assert.equal(res.outcome, "already_resolved");
});

// ---------------- Integration — happy path still acknowledges ----------------
test("integration: a confident acknowledgment stops the chain with outcome=acknowledged", async () => {
  const res = await runEscalation(baseOpts({
    contactChain: [
      { role: "trainer", phone_e164: "+15550101234", order: 1 },
      { role: "physician", phone_e164: "+15550105678", order: 2 },
    ],
    _placeCall: async (_a, c) => interpretAck("COMPLETED", { outcome: okOutcome }, c.role),
  }));
  assert.equal(res.outcome, "acknowledged");
  assert.equal(res.attempts.length, 1);
});
