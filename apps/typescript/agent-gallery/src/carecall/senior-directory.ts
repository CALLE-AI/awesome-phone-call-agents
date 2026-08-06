import { isPermittedCallWindowFormat, permittedCallWindowMinutes } from "../workflows/carecall";
import type { CareRoutine, Senior, SeniorEdit } from "./types";

/**
 * Senior edits and withdrawals as pure transitions over the demo directory.
 *
 * Withdrawal is modelled as a state change rather than a removal. A senior who
 * has been called still owns that call history, the needs-review cases raised
 * from it, and the audit trail; deleting the record would leave those records
 * describing nobody. Withdrawal instead removes the senior from every path that
 * can dial: routines stop being schedulable, and no new authorization is
 * offered. An ongoing provider call is unaffected here by design, because the
 * client cannot recall a call the provider has already accepted.
 */

export type SeniorEditErrors = Partial<Record<keyof SeniorEdit, string>>;

export const OTHER_OPTION = "Other";

/** Singapore's official languages first, then the dialects seniors commonly prefer. */
export const languageOptions = [
  "English",
  "Mandarin",
  "Malay",
  "Tamil",
  "Cantonese",
  "Hokkien",
  "Teochew",
  "Hakka",
  "Hainanese",
] as const;

export const caregiverRelationshipOptions = [
  "Daughter",
  "Son",
  "Spouse",
  "Sibling",
  "Grandson",
  "Granddaughter",
  "Nephew",
  "Niece",
  "Care coordinator",
  "Domestic helper",
  "Neighbour",
  "Friend",
] as const;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: string): boolean {
  return CLOCK.test(value.trim());
}

function clockFromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Splits a stored window into the two 24-hour values the time inputs use. */
export function callWindowTimes(windowText: string): { from: string; to: string } {
  const window = permittedCallWindowMinutes(windowText);
  if (!window) return { from: "", to: "" };
  return { from: clockFromMinutes(window.start), to: clockFromMinutes(window.end) };
}

/**
 * Rebuilds the stored display window the workflow parses. Times chosen in the
 * editor are 24-hour, but the permitted window is stored and validated in the
 * 12-hour form, so the two are converted here rather than at each call site.
 */
export function formatCallWindow(from: string, to: string): string {
  if (!isClockTime(from) || !isClockTime(to)) return "";
  const label = (value: string) => {
    const [hour, minute] = value.trim().split(":").map(Number);
    const meridiem = hour < 12 ? "AM" : "PM";
    return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${meridiem}`;
  };
  return `${label(from)}–${label(to)}`;
}

/** True when the chosen window runs past midnight, which permits night calls. */
export function callWindowSpansMidnight(from: string, to: string): boolean {
  if (!isClockTime(from) || !isClockTime(to)) return false;
  return from.trim() > to.trim();
}

export function isKnownOption(options: readonly string[], value: string): boolean {
  return options.includes(value.trim());
}

export interface WithdrawalImpact {
  routineCount: number;
  routineTitles: string[];
  openCaseCount: number;
}

export function seniorEditFrom(senior: Senior): SeniorEdit {
  const times = callWindowTimes(senior.callWindow);
  return {
    name: senior.name,
    preferredName: senior.preferredName,
    language: senior.language,
    callWindowFrom: times.from,
    callWindowTo: times.to,
    caregiver: senior.caregiver,
    caregiverRelationship: senior.caregiverRelationship,
  };
}

export function normalizeSeniorEdit(edit: SeniorEdit): SeniorEdit {
  return {
    name: edit.name.trim(),
    preferredName: edit.preferredName.trim(),
    language: edit.language.trim(),
    callWindowFrom: edit.callWindowFrom.trim(),
    callWindowTo: edit.callWindowTo.trim(),
    caregiver: edit.caregiver.trim(),
    caregiverRelationship: edit.caregiverRelationship.trim(),
  };
}

/**
 * The call window is validated against the same pattern the workflow uses. An
 * unparsable window is treated as outside every window, so accepting a typo
 * here would silently stop the senior's reminders instead of failing visibly.
 */
export function validateSeniorEdit(edit: SeniorEdit): SeniorEditErrors {
  const normalized = normalizeSeniorEdit(edit);
  const errors: SeniorEditErrors = {};
  if (!normalized.name) errors.name = "Enter the senior's full name.";
  if (!normalized.preferredName) errors.preferredName = "Enter the name CareCall should use on the call.";
  if (!normalized.language) errors.language = "Select the language for this senior.";
  if (!normalized.callWindowFrom) {
    errors.callWindowFrom = "Choose the earliest time CareCall may call.";
  } else if (!isClockTime(normalized.callWindowFrom)) {
    errors.callWindowFrom = "Choose a valid time.";
  }
  if (!normalized.callWindowTo) {
    errors.callWindowTo = "Choose the latest time CareCall may call.";
  } else if (!isClockTime(normalized.callWindowTo)) {
    errors.callWindowTo = "Choose a valid time.";
  }
  if (!errors.callWindowFrom && !errors.callWindowTo) {
    if (normalized.callWindowFrom === normalized.callWindowTo) {
      errors.callWindowTo = "The window must cover more than a single minute.";
    } else if (!isPermittedCallWindowFormat(formatCallWindow(normalized.callWindowFrom, normalized.callWindowTo))) {
      // The composed window must survive the workflow's own parser, or the
      // stored record would block every call for this senior.
      errors.callWindowTo = "This window cannot be stored. Choose different times.";
    }
  }
  if (!normalized.caregiver) errors.caregiver = "Enter the primary caregiver.";
  if (!normalized.caregiverRelationship) errors.caregiverRelationship = "Select or describe the caregiver's relationship.";
  return errors;
}

export function hasSeniorEditErrors(errors: SeniorEditErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Initials follow the displayed name so the avatar cannot drift from it. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => /\p{L}/u.test(part));
  const letters = parts.map((part) => [...part].find((character) => /\p{L}/u.test(character)) ?? "");
  const initials = (letters.length > 1 ? `${letters[0]}${letters.at(-1)}` : letters[0] ?? "").toUpperCase();
  return initials || "?";
}

export function applySeniorEdit(seniors: Senior[], seniorId: string, edit: SeniorEdit): Senior[] {
  const normalized = normalizeSeniorEdit(edit);
  if (hasSeniorEditErrors(validateSeniorEdit(normalized))) return seniors;
  const { callWindowFrom, callWindowTo, ...fields } = normalized;
  return seniors.map((senior) => (senior.id === seniorId
    ? {
      ...senior,
      ...fields,
      callWindow: formatCallWindow(callWindowFrom, callWindowTo),
      initials: initialsFor(fields.name),
    }
    : senior));
}

export function withdrawSenior(seniors: Senior[], seniorId: string, withdrawnOn: string): Senior[] {
  return seniors.map((senior) => (senior.id === seniorId && senior.status === "active"
    ? { ...senior, status: "withdrawn", withdrawnOn, nextReminder: "—", nextReminderLabel: "No scheduled reminders" }
    : senior));
}

export function restoreSenior(seniors: Senior[], seniorId: string): Senior[] {
  return seniors.map((senior) => (senior.id === seniorId && senior.status === "withdrawn"
    ? { ...senior, status: "active", withdrawnOn: undefined }
    : senior));
}

/** A withdrawn senior is never callable, whatever a routine or timeline says. */
export function seniorIsCallable(senior: Senior | undefined): boolean {
  return senior?.status === "active";
}

export function routineIsSchedulable(senior: Senior | undefined, routine: CareRoutine): boolean {
  return seniorIsCallable(senior) && routine.status === "active";
}

export function withdrawalImpact(
  seniorId: string,
  routines: CareRoutine[],
  openCaseCount: number,
): WithdrawalImpact {
  const affected = routines.filter((routine) => routine.seniorId === seniorId);
  return {
    routineCount: affected.length,
    routineTitles: affected.map((routine) => routine.title),
    openCaseCount,
  };
}
