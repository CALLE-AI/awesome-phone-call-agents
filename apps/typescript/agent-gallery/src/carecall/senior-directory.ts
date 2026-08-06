import { isPermittedCallWindowFormat } from "../workflows/carecall";
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

export interface WithdrawalImpact {
  routineCount: number;
  routineTitles: string[];
  openCaseCount: number;
}

export function seniorEditFrom(senior: Senior): SeniorEdit {
  return {
    name: senior.name,
    preferredName: senior.preferredName,
    language: senior.language,
    callWindow: senior.callWindow,
    caregiver: senior.caregiver,
    caregiverRelationship: senior.caregiverRelationship,
  };
}

export function normalizeSeniorEdit(edit: SeniorEdit): SeniorEdit {
  return {
    name: edit.name.trim(),
    preferredName: edit.preferredName.trim(),
    language: edit.language.trim(),
    callWindow: edit.callWindow.trim(),
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
  if (!normalized.language) errors.language = "Enter the language for this senior.";
  if (!normalized.callWindow) {
    errors.callWindow = "Enter a permitted call window.";
  } else if (!isPermittedCallWindowFormat(normalized.callWindow)) {
    errors.callWindow = "Use a 12-hour range such as 8:00 AM–8:00 PM. An unreadable window blocks every call.";
  }
  if (!normalized.caregiver) errors.caregiver = "Enter the primary caregiver.";
  if (!normalized.caregiverRelationship) errors.caregiverRelationship = "Enter the caregiver's relationship.";
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
  return seniors.map((senior) => (senior.id === seniorId
    ? { ...senior, ...normalized, initials: initialsFor(normalized.name) }
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
