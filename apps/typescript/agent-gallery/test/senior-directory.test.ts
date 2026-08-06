import assert from "node:assert/strict";
import test from "node:test";
import {
  applySeniorEdit,
  callWindowSpansMidnight,
  callWindowTimes,
  caregiverRelationshipOptions,
  formatCallWindow,
  isKnownOption,
  languageOptions,
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
    callWindowFrom: "",
    callWindowTo: "",
    caregiver: "",
    caregiverRelationship: "",
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "callWindowFrom",
    "callWindowTo",
    "caregiver",
    "caregiverRelationship",
    "language",
    "name",
    "preferredName",
  ]);
});

test("an unusable time is rejected rather than silently blocking every call", () => {
  for (const callWindowFrom of ["", "8am", "25:00", "8:00 AM", "0800"]) {
    const errors = validateSeniorEdit(validEdit({ callWindowFrom }));
    assert.ok(errors.callWindowFrom, `${callWindowFrom} should be rejected`);
  }
});

test("a window covering a single minute is rejected", () => {
  const errors = validateSeniorEdit(validEdit({ callWindowFrom: "09:00", callWindowTo: "09:00" }));
  assert.ok(errors.callWindowTo);
});

test("windows the workflow can parse are accepted, including overnight ranges", () => {
  for (const [from, to] of [["08:00", "20:00"], ["21:30", "06:00"], ["00:00", "23:59"]]) {
    const errors = validateSeniorEdit(validEdit({ callWindowFrom: from, callWindowTo: to }));
    assert.equal(errors.callWindowFrom, undefined, `${from}-${to} should be accepted`);
    assert.equal(errors.callWindowTo, undefined, `${from}-${to} should be accepted`);
  }
});

test("chosen times compose into the 12-hour window the workflow stores", () => {
  assert.equal(formatCallWindow("08:00", "20:00"), "8:00 AM–8:00 PM");
  assert.equal(formatCallWindow("00:00", "12:05"), "12:00 AM–12:05 PM");
  assert.equal(formatCallWindow("09:30", "19:45"), "9:30 AM–7:45 PM");
  assert.equal(formatCallWindow("bad", "20:00"), "");
});

test("a stored window splits back into the times the pickers show", () => {
  assert.deepEqual(callWindowTimes("8:00 AM–8:00 PM"), { from: "08:00", to: "20:00" });
  assert.deepEqual(callWindowTimes("12:00 AM–11:59 PM"), { from: "00:00", to: "23:59" });
  assert.deepEqual(callWindowTimes("not a window"), { from: "", to: "" });
});

test("every fixture window survives a split and rebuild unchanged", () => {
  for (const stored of ["8:00 AM–8:00 PM", "8:30 AM–7:30 PM", "9:00 AM–8:00 PM", "8:00 AM–8:30 PM"]) {
    const times = callWindowTimes(stored);
    assert.equal(formatCallWindow(times.from, times.to), stored);
  }
});

test("a window running past midnight is reported so overnight calling is visible", () => {
  assert.equal(callWindowSpansMidnight("21:00", "06:00"), true);
  assert.equal(callWindowSpansMidnight("08:00", "20:00"), false);
  assert.equal(callWindowSpansMidnight("", "20:00"), false);
});

test("stored values outside the option lists are recognised as free-text remarks", () => {
  assert.equal(isKnownOption(languageOptions, "Mandarin"), true);
  assert.equal(isKnownOption(languageOptions, "Javanese"), false);
  assert.equal(isKnownOption(caregiverRelationshipOptions, "Care coordinator"), true);
  assert.equal(isKnownOption(caregiverRelationshipOptions, "Former colleague"), false);
});

test("every language and relationship already in the fixtures is offered as an option", () => {
  for (const value of ["English", "Malay", "Mandarin"]) {
    assert.equal(isKnownOption(languageOptions, value), true, `${value} should be listed`);
  }
  for (const value of ["Daughter", "Son", "Care coordinator", "Granddaughter"]) {
    assert.equal(isKnownOption(caregiverRelationshipOptions, value), true, `${value} should be listed`);
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
  const updated = applySeniorEdit(original, "mdm-lim", validEdit({ callWindowFrom: "whenever" }));
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
