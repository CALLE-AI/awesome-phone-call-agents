import assert from "node:assert/strict";
import test from "node:test";
import { conversationPlanFor, routineKindOrder, routineKindProfile } from "../src/carecall/routine-kinds";
import {
  addRoutine,
  emptyRoutineDraft,
  hasRoutineDraftErrors,
  nextRunLabel,
  routineFromDraft,
  routineIdFor,
  scheduleLabel,
  trustFirstOpening,
  validateRoutineDraft,
  type RoutineDraft,
} from "../src/carecall/routine-directory";
import { careCallRoutineKinds } from "../src/workflows/carecall";
import type { CareRoutine, Senior } from "../src/carecall/types";

function senior(overrides: Partial<Senior> = {}): Senior {
  return {
    id: "mdm-lim",
    name: "Mdm Lim Siew Lan",
    preferredName: "Mdm Lim",
    initials: "LL",
    language: "English",
    callWindow: "8:00 AM–8:00 PM",
    caregiver: "Joanne Lim",
    caregiverRelationship: "Daughter",
    phoneMasked: "+65 •••• 4821",
    lastContact: "Today, 8:04 AM",
    nextReminder: "Today, 6:30 PM",
    nextReminderLabel: "Dinner check-in",
    attentionCount: 0,
    avatar: "blue",
    status: "active",
    ...overrides,
  };
}

const validDraft = (overrides: Partial<RoutineDraft> = {}): RoutineDraft => ({
  ...emptyRoutineDraft("mdm-lim"),
  title: "Morning medication",
  caregiverInstruction: "Remind Mdm Lim to take the morning compartment.",
  trustPhrase: "Joanne asked me to call about your morning routine.",
  timeSgt: "09:00",
  ...overrides,
});

test("a complete draft reports no errors", () => {
  assert.equal(hasRoutineDraftErrors(validateRoutineDraft(validDraft(), senior())), false);
});

test("every required field is reported when blank", () => {
  const errors = validateRoutineDraft(
    { seniorId: "", kind: "medication", title: "", caregiverInstruction: "", trustPhrase: "", frequency: "daily", timeSgt: "" },
    undefined,
  );
  assert.deepEqual(Object.keys(errors).sort(), ["caregiverInstruction", "seniorId", "timeSgt", "title", "trustPhrase"]);
});

test("a time outside the senior's permitted window is refused when the routine is written", () => {
  const errors = validateRoutineDraft(validDraft({ timeSgt: "06:30" }), senior());
  assert.ok(errors.timeSgt);
  assert.match(errors.timeSgt!, /8:00 AM–8:00 PM/);
});

test("a time inside the permitted window is accepted, including its edges", () => {
  for (const timeSgt of ["08:00", "12:00", "20:00"]) {
    assert.equal(validateRoutineDraft(validDraft({ timeSgt }), senior()).timeSgt, undefined, `${timeSgt} should be accepted`);
  }
});

test("a withdrawn senior cannot be given a new routine", () => {
  const errors = validateRoutineDraft(validDraft(), senior({ status: "withdrawn" }));
  assert.ok(errors.seniorId);
  assert.match(errors.seniorId!, /withdrawn/);
});

test("a senior missing from the directory is refused", () => {
  assert.ok(validateRoutineDraft(validDraft(), undefined).seniorId);
});

test("a created routine starts paused so it cannot call before it is authorized", () => {
  const routine = routineFromDraft(validDraft(), []);
  assert.equal(routine.status, "paused");
  assert.match(routine.nextRun, /Not scheduled/);
});

test("a created routine carries the operator's wording unchanged", () => {
  const routine = routineFromDraft(validDraft(), []);
  assert.equal(routine.caregiverInstruction, "Remind Mdm Lim to take the morning compartment.");
  assert.equal(routine.trustPhrase, "Joanne asked me to call about your morning routine.");
  assert.equal(routine.kind, "medication");
  assert.equal(routine.seniorId, "mdm-lim");
});

test("routine ids are slugged from the title and stay unique", () => {
  const first = routineIdFor(validDraft(), []);
  assert.equal(first, "mdm-lim-morning-medication");
  const existing: CareRoutine[] = [routineFromDraft(validDraft(), [])];
  assert.notEqual(routineIdFor(validDraft(), existing), first);
});

test("an invalid draft adds nothing to the directory", () => {
  const existing: CareRoutine[] = [];
  assert.equal(addRoutine(existing, validDraft({ timeSgt: "06:30" }), senior()).length, 0);
  assert.equal(addRoutine(existing, validDraft(), senior()).length, 1);
});

test("the schedule and next-run labels read in 12-hour Singapore time", () => {
  assert.equal(scheduleLabel("daily", "09:00"), "Daily at 9:00 AM");
  assert.equal(scheduleLabel("weekdays", "18:30"), "Weekdays at 6:30 PM");
  assert.match(nextRunLabel("daily", "09:00"), /^Not scheduled · daily at 9:00 AM/);
});

test("the trust-first opening names the assistant and refuses money, OTP, and bank details", () => {
  const opening = trustFirstOpening("Mdm Lim", "Joanne asked me to call.");
  assert.match(opening, /automated calling assistant/);
  assert.match(opening, /never ask for money, an OTP, or bank information/);
  assert.match(opening, /Joanne asked me to call\./);
});

test("an empty trust phrase still produces a complete opening", () => {
  assert.match(trustFirstOpening("Mdm Lim", "   "), /A caregiver asked me to call\./);
});

test("every routine kind offered in the interface is a kind a live call accepts", () => {
  for (const kind of routineKindOrder) {
    assert.ok(careCallRoutineKinds.includes(kind), `${kind} must be accepted by the workflow`);
  }
  assert.equal(routineKindOrder.length, careCallRoutineKinds.length);
});

test("every kind has its own label, icon, purpose, and stated boundary", () => {
  const boundaries = new Set<string>();
  for (const kind of routineKindOrder) {
    const profile = routineKindProfile(kind);
    assert.ok(profile.label && profile.callLabel && profile.icon && profile.purpose, `${kind} is incomplete`);
    assert.ok(profile.boundary.length > 30, `${kind} needs a stated boundary`);
    boundaries.add(profile.boundary);
  }
  assert.equal(boundaries.size, routineKindOrder.length, "each kind states its own boundary");
});

test("the wellbeing boundary rules out assessment and interpretation", () => {
  const boundary = routineKindProfile("wellbeing").boundary;
  assert.match(boundary, /does not assess mood/);
  assert.match(boundary, /goes to a human/);
});

test("the appointment boundary rules out booking or changing anything", () => {
  assert.match(routineKindProfile("appointment").boundary, /never books, moves, or cancels/);
});

test("every kind's plan keeps the same four-step shape and escalation step", () => {
  for (const kind of routineKindOrder) {
    const plan = conversationPlanFor(kind, "Mdm Lim", "Joanne Lim");
    assert.equal(plan.length, 4, `${kind} should keep four steps`);
    assert.match(plan[0].detail, /Mdm Lim/);
    assert.equal(plan[3].title, "Escalate uncertainty");
    assert.match(plan[3].detail, /Joanne Lim/);
  }
});
