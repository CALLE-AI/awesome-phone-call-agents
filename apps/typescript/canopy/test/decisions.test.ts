import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POLICY, escalationDisposition, nextAction } from "../src/cascade.js";
import { classify } from "../src/classify.js";
import { planWaves, scorePerson } from "../src/risk.js";
import type { Person, TriageResult } from "../src/types.js";

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "Test Person",
    phone: "+14155550101",
    locale: "en-US",
    region: "US",
    age: 80,
    livesAlone: true,
    hasCooling: "no",
    medicalRisks: [],
    address: null,
    lat: null,
    lng: null,
    contactName: "Kin",
    contactPhone: "+14155550111",
    contactLocale: null,
    consent: true,
    consentDate: null,
    notes: null,
    scenario: null,
    ...overrides,
  };
}

function triage(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    answered_by: "person",
    is_cool: "yes",
    hydrated: "yes",
    symptoms: ["none"],
    confusion_suspected: false,
    needs: ["none"],
    tier: "green",
    notes: "",
    ...overrides,
  };
}

function recipient(result: TriageResult | Record<string, unknown> | null, status: "completed" | "failed" = "completed") {
  return {
    status,
    structuredResult: result as Record<string, unknown> | null,
    attempts: [{ id: "att_1", phone: "+14155550101", status, startedAt: null, completedAt: null, summary: null, transcriptTurns: [], providerCallId: null, failureCode: status === "failed" ? "no_answer" : null, failureMessage: null }],
  };
}

test("green requires every signal to agree", () => {
  assert.equal(classify({ recipient: recipient(triage()), confidenceLabel: "high" }).outcome, "green");
});

test("a failed attempt is unreachable, whatever the agent said", () => {
  const c = classify({ recipient: recipient(triage(), "failed"), confidenceLabel: "high" });
  assert.equal(c.outcome, "unreachable");
  assert.ok(c.reasons[0]?.includes("no_answer"));
});

test("a completed call with a null structured result is unverified, never green", () => {
  assert.equal(classify({ recipient: recipient(null), confidenceLabel: "high" }).outcome, "unverified");
});

test("voicemail is not reached", () => {
  assert.equal(classify({ recipient: recipient(triage({ answered_by: "voicemail" })), confidenceLabel: "high" }).outcome, "unreachable");
});

test("confusion overrides a softer agent tier upward", () => {
  const c = classify({ recipient: recipient(triage({ tier: "yellow", confusion_suspected: true, is_cool: "unknown", hydrated: "unknown" })), confidenceLabel: "high" });
  assert.equal(c.outcome, "red");
  assert.equal(c.agentTier, "yellow");
});

test("red-flag symptoms force red even when the agent said green", () => {
  assert.equal(classify({ recipient: recipient(triage({ symptoms: ["hot_dry_skin"] })), confidenceLabel: "high" }).outcome, "red");
});

test("not cool or not hydrated is at least yellow", () => {
  assert.equal(classify({ recipient: recipient(triage({ is_cool: "no" })), confidenceLabel: "high" }).outcome, "yellow");
  assert.equal(classify({ recipient: recipient(triage({ hydrated: "no" })), confidenceLabel: "high" }).outcome, "yellow");
});

test("unknown cooling never closes as green", () => {
  assert.equal(classify({ recipient: recipient(triage({ is_cool: "unknown" })), confidenceLabel: "high" }).outcome, "unverified");
});

test("low completion confidence downgrades green to unverified", () => {
  assert.equal(classify({ recipient: recipient(triage()), confidenceLabel: "low" }).outcome, "unverified");
});

test("a caregiver answering can still be green but the reason says so", () => {
  const c = classify({ recipient: recipient(triage({ answered_by: "other_person" })), confidenceLabel: "high" });
  assert.equal(c.outcome, "green");
  assert.ok(c.reasons.some((r) => r.includes("caregiver")));
});

test("the tier never moves down from what the agent said", () => {
  assert.equal(classify({ recipient: recipient(triage({ tier: "red" })), confidenceLabel: "high" }).outcome, "red");
});

test("a person who answered and asked to be called later is declined: follow up later, never escalate", () => {
  const c = classify({ recipient: recipient(triage({ call_outcome: "declined_now", is_cool: "unknown", hydrated: "unknown", symptoms: [], needs: [], tier: "yellow" })), confidenceLabel: "high" });
  assert.equal(c.outcome, "declined");
  const a = nextAction({ attempts: 2, contactCalled: false, outcome: "declined" }, true);
  assert.equal(a.type, "follow-up");
  assert.equal(a.delayMinutes, DEFAULT_POLICY.declinedRetryMinutes);
});

test("declining does not hide a volunteered red flag", () => {
  const c = classify({ recipient: recipient(triage({ call_outcome: "declined_now", symptoms: ["faint"], tier: "yellow" })), confidenceLabel: "high" });
  assert.equal(c.outcome, "red");
});

test("a conversation cut short is unverified", () => {
  assert.equal(classify({ recipient: recipient(triage({ call_outcome: "cut_short" })), confidenceLabel: "high" }).outcome, "unverified");
});

test("cascade: unreachable is redialled once, then the contact is phoned, then a door knock", () => {
  assert.equal(nextAction({ attempts: 1, contactCalled: false, outcome: "unreachable" }, true).type, "retry");
  assert.equal(nextAction({ attempts: 2, contactCalled: false, outcome: "unreachable" }, true).type, "contact-call");
  assert.equal(nextAction({ attempts: 2, contactCalled: true, outcome: "unreachable" }, true).type, "door-knock");
  assert.equal(nextAction({ attempts: 2, contactCalled: false, outcome: "unreachable" }, false).type, "door-knock");
});

test("cascade: red escalates immediately and suggests emergency services", () => {
  const a = nextAction({ attempts: 1, contactCalled: false, outcome: "red" }, true);
  assert.equal(a.type, "escalate");
  assert.equal(a.suggestEmergencyServices, true);
  assert.equal(nextAction({ attempts: 1, contactCalled: false, outcome: "red" }, false).type, "door-knock");
});

test("cascade: yellow gets a timed follow-up, green closes", () => {
  const a = nextAction({ attempts: 1, contactCalled: false, outcome: "yellow" }, true);
  assert.equal(a.type, "follow-up");
  assert.equal(a.delayMinutes, DEFAULT_POLICY.followUpHours * 60);
  assert.equal(nextAction({ attempts: 1, contactCalled: false, outcome: "green" }, true).type, "close");
});

test("escalation: only a clear yes is a commitment; vague answers become a door knock", () => {
  assert.deepEqual(escalationDisposition({ reached: "yes", will_check: "yes", eta_minutes: 15, wants_emergency_services: "no", notes: "" }, "unreachable"), { kind: "contact_committed", etaMinutes: 15 });
  assert.equal(escalationDisposition({ reached: "yes", will_check: "unknown", eta_minutes: 0, wants_emergency_services: "no", notes: "" }, "unreachable").kind, "door_knock");
  assert.equal(escalationDisposition(null, "red").kind, "door_knock");
  assert.equal(escalationDisposition({ reached: "yes", will_check: "yes", eta_minutes: 10, wants_emergency_services: "yes", notes: "" }, "red").kind, "emergency_services");
});

test("escalation: a long ETA is not good enough for a red person", () => {
  assert.equal(escalationDisposition({ reached: "yes", will_check: "yes", eta_minutes: 120, wants_emergency_services: "no", notes: "" }, "red").kind, "door_knock");
  assert.equal(escalationDisposition({ reached: "yes", will_check: "yes", eta_minutes: 120, wants_emergency_services: "no", notes: "" }, "unreachable").kind, "contact_committed");
});

test("risk: age, living alone, no cooling and medical conditions add up; waves never mix priorities", () => {
  const high = scorePerson(person({ age: 88, medicalRisks: ["dementia"] }), "heat");
  const low = scorePerson(person({ age: 66, livesAlone: false, hasCooling: "yes" }), "heat");
  assert.equal(high.priority, 1);
  assert.equal(low.priority, 3);
  const waves = planWaves([person({ id: "a", age: 88, medicalRisks: ["dementia"] }), person({ id: "b", age: 66, livesAlone: false, hasCooling: "yes" }), person({ id: "c", age: 90 })], "heat", 5);
  assert.equal(waves.length, 2);
  assert.deepEqual(waves[0]?.personIds, ["a", "c"]);
  assert.deepEqual(waves[1]?.personIds, ["b"]);
});

test("risk: oxygen dependence weighs more in a power outage than in heat", () => {
  const heat = scorePerson(person({ medicalRisks: ["oxygen"], hasCooling: "yes" }), "heat");
  const outage = scorePerson(person({ medicalRisks: ["oxygen"], hasCooling: "yes" }), "outage-medical");
  assert.ok(outage.score > heat.score);
});
