import assert from "node:assert/strict";
import test from "node:test";
import {
  applySeniorEdit,
  hasSeniorEditErrors,
  initialsFor,
  normalizeSeniorEdit,
  restoreSenior,
  seniorEditFrom,
  seniorIsCallable,
  routineIsSchedulable,
  validateSeniorEdit,
  withdrawSenior,
  withdrawalImpact,
} from "../src/carecall/senior-directory";
import type { CareRoutine, Senior, SeniorEdit } from "../src/carecall/types";

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

function routine(overrides: Partial<CareRoutine> = {}): CareRoutine {
  return {
    id: "lim-dinner",
    seniorId: "mdm-lim",
    kind: "meal",
    title: "Dinner check-in",
    caregiverInstruction: "Ask whether dinner has been eaten.",
    schedule: "Daily at 6:30 PM",
    nextRun: "Today, 6:30 PM",
    status: "active",
    trustPhrase: "Joanne asked me to check in.",
    ...overrides,
  };
}

const validEdit = (overrides: Partial<SeniorEdit> = {}): SeniorEdit => ({
  ...seniorEditFrom(senior()),
  ...overrides,
});

test("a valid edit reports no errors", () => {
  assert.equal(hasSeniorEditErrors(validateSeniorEdit(validEdit())), false);
});

test("every required field is reported when blank", () => {
  const errors = validateSeniorEdit({
    name: "",
    preferredName: "  ",
    language: "",
    callWindow: "",
    caregiver: "",
    caregiverRelationship: "",
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "callWindow",
    "caregiver",
    "caregiverRelationship",
    "language",
    "name",
    "preferredName",
  ]);
});

test("an unparsable call window is rejected rather than silently blocking every call", () => {
  for (const callWindow of ["8am to 8pm", "08:00–20:00", "8:00 AM", "anytime", "8:00 XM–8:00 PM"]) {
    const errors = validateSeniorEdit(validEdit({ callWindow }));
    assert.ok(errors.callWindow, `${callWindow} should be rejected`);
  }
});

test("call windows the workflow can parse are accepted, including overnight ranges", () => {
  for (const callWindow of ["8:00 AM–8:00 PM", "8:00 AM-8:00 PM", "9:30 PM–6:00 AM", "12:00 AM–11:59 PM"]) {
    const errors = validateSeniorEdit(validEdit({ callWindow }));
    assert.equal(errors.callWindow, undefined, `${callWindow} should be accepted`);
  }
});

test("an edit trims surrounding whitespace before it is stored", () => {
  const normalized = normalizeSeniorEdit(validEdit({ preferredName: "  Mdm Lim  ", caregiver: " Joanne Lim " }));
  assert.equal(normalized.preferredName, "Mdm Lim");
  assert.equal(normalized.caregiver, "Joanne Lim");
});

test("applying an edit updates the record and re-derives its initials", () => {
  const updated = applySeniorEdit([senior()], "mdm-lim", validEdit({ name: "Mdm Lim Siew Ling", preferredName: "Auntie Lim" }));
  assert.equal(updated[0].name, "Mdm Lim Siew Ling");
  assert.equal(updated[0].preferredName, "Auntie Lim");
  assert.equal(updated[0].initials, "ML");
});

test("an invalid edit leaves the directory unchanged", () => {
  const original = [senior()];
  const updated = applySeniorEdit(original, "mdm-lim", validEdit({ callWindow: "whenever" }));
  assert.deepEqual(updated, original);
});

test("an edit touches only the named senior", () => {
  const directory = [senior(), senior({ id: "mr-tan", name: "Mr Tan Kok Leong", preferredName: "Mr Tan" })];
  const updated = applySeniorEdit(directory, "mdm-lim", validEdit({ preferredName: "Auntie Lim" }));
  assert.equal(updated[1].preferredName, "Mr Tan");
});

test("initials come from the first and last name parts", () => {
  assert.equal(initialsFor("Mdm Lim Siew Lan"), "ML");
  assert.equal(initialsFor("Rahman"), "R");
  assert.equal(initialsFor("  "), "?");
});

test("withdrawal keeps the record but stops it being callable", () => {
  const [withdrawn] = withdrawSenior([senior()], "mdm-lim", "6 Aug 2026");
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.withdrawnOn, "6 Aug 2026");
  assert.equal(withdrawn.name, "Mdm Lim Siew Lan");
  assert.equal(seniorIsCallable(withdrawn), false);
});

test("withdrawal clears the next reminder so no future call is implied", () => {
  const [withdrawn] = withdrawSenior([senior()], "mdm-lim", "6 Aug 2026");
  assert.equal(withdrawn.nextReminder, "—");
  assert.equal(withdrawn.nextReminderLabel, "No scheduled reminders");
});

test("withdrawing an already withdrawn senior does not overwrite the original date", () => {
  const once = withdrawSenior([senior()], "mdm-lim", "1 Aug 2026");
  const twice = withdrawSenior(once, "mdm-lim", "6 Aug 2026");
  assert.equal(twice[0].withdrawnOn, "1 Aug 2026");
});

test("a withdrawn senior's active routines are not schedulable", () => {
  const [withdrawn] = withdrawSenior([senior()], "mdm-lim", "6 Aug 2026");
  assert.equal(routineIsSchedulable(withdrawn, routine()), false);
  assert.equal(routineIsSchedulable(senior(), routine()), true);
  assert.equal(routineIsSchedulable(senior(), routine({ status: "paused" })), false);
});

test("an unknown senior is never callable", () => {
  assert.equal(seniorIsCallable(undefined), false);
});

test("restoring returns the senior to active care and clears the withdrawal date", () => {
  const withdrawn = withdrawSenior([senior()], "mdm-lim", "6 Aug 2026");
  const [restored] = restoreSenior(withdrawn, "mdm-lim");
  assert.equal(restored.status, "active");
  assert.equal(restored.withdrawnOn, undefined);
  assert.equal(seniorIsCallable(restored), true);
});

test("withdrawal impact counts the routines that will stop and the cases that remain", () => {
  const impact = withdrawalImpact("mdm-lim", [routine(), routine({ id: "lim-morning", title: "Morning medication" }), routine({ id: "tan-lunch", seniorId: "mr-tan" })], 2);
  assert.equal(impact.routineCount, 2);
  assert.deepEqual(impact.routineTitles, ["Dinner check-in", "Morning medication"]);
  assert.equal(impact.openCaseCount, 2);
});
