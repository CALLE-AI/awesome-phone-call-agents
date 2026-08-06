import { isScheduledTimeWithinPermittedWindow } from "../workflows/carecall";
import { formatCallWindow, isClockTime } from "./senior-directory";
import type { CareRoutine, RoutineKind, Senior } from "./types";

/**
 * Building a care routine, as pure transitions.
 *
 * A routine only describes a call; it never places one. Activating the
 * schedule and authorizing a single call remain separate, explicit steps, so a
 * routine created here is inert until an operator authorizes it.
 */

export type RoutineFrequency = "daily" | "weekdays";

export interface RoutineDraft {
  seniorId: string;
  kind: RoutineKind;
  title: string;
  caregiverInstruction: string;
  trustPhrase: string;
  frequency: RoutineFrequency;
  timeSgt: string;
}

export type RoutineDraftErrors = Partial<Record<keyof RoutineDraft, string>>;

export const routineFrequencyLabels: Record<RoutineFrequency, string> = {
  daily: "Daily",
  weekdays: "Weekdays",
};

export function emptyRoutineDraft(seniorId: string, kind: RoutineKind = "medication"): RoutineDraft {
  return { seniorId, kind, title: "", caregiverInstruction: "", trustPhrase: "", frequency: "daily", timeSgt: "08:00" };
}

export function normalizeRoutineDraft(draft: RoutineDraft): RoutineDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    caregiverInstruction: draft.caregiverInstruction.trim(),
    trustPhrase: draft.trustPhrase.trim(),
    timeSgt: draft.timeSgt.trim(),
  };
}

/**
 * A time outside the senior's permitted window is refused here rather than at
 * dial time. The worker would send the occurrence to human review, which is
 * safe but silent, and the operator would have no idea why the reminder never
 * went out.
 */
export function validateRoutineDraft(draft: RoutineDraft, senior: Senior | undefined): RoutineDraftErrors {
  const normalized = normalizeRoutineDraft(draft);
  const errors: RoutineDraftErrors = {};
  if (!normalized.seniorId) errors.seniorId = "Choose the senior this routine is for.";
  else if (!senior) errors.seniorId = "That senior is not in the care directory.";
  else if (senior.status === "withdrawn") errors.seniorId = `${senior.preferredName} is withdrawn from care calls and cannot take a new routine.`;
  if (!normalized.title) errors.title = "Name the routine so it is recognisable in the call console.";
  if (!normalized.caregiverInstruction) errors.caregiverInstruction = "Enter the caregiver-approved wording the agent must repeat.";
  if (!normalized.trustPhrase) errors.trustPhrase = "Enter the trust phrase that says who asked for the call.";
  if (!isClockTime(normalized.timeSgt)) {
    errors.timeSgt = "Choose a valid time.";
  } else if (senior && !isScheduledTimeWithinPermittedWindow(senior.callWindow, normalized.timeSgt)) {
    errors.timeSgt = `Outside ${senior.preferredName}'s permitted window of ${senior.callWindow}. The call would be refused.`;
  }
  return errors;
}

export function hasRoutineDraftErrors(errors: RoutineDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function routineIdFor(draft: RoutineDraft, existing: CareRoutine[], now = Date.now()): string {
  const slug = draft.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || draft.kind;
  const base = `${draft.seniorId}-${slug}`;
  if (!existing.some((routine) => routine.id === base)) return base;
  return `${base}-${now.toString(36).slice(-4)}`;
}

export function scheduleLabel(frequency: RoutineFrequency, timeSgt: string): string {
  const clock = formatCallWindow(timeSgt, timeSgt).split("–")[0];
  return `${routineFrequencyLabels[frequency]} at ${clock}`;
}

/** Deliberately relative: no occurrence exists until a schedule is authorized. */
export function nextRunLabel(frequency: RoutineFrequency, timeSgt: string): string {
  const clock = formatCallWindow(timeSgt, timeSgt).split("–")[0];
  return `Not scheduled · ${routineFrequencyLabels[frequency].toLowerCase()} at ${clock} once activated`;
}

export function routineFromDraft(draft: RoutineDraft, existing: CareRoutine[], now = Date.now()): CareRoutine {
  const normalized = normalizeRoutineDraft(draft);
  return {
    id: routineIdFor(normalized, existing, now),
    seniorId: normalized.seniorId,
    kind: normalized.kind,
    title: normalized.title,
    caregiverInstruction: normalized.caregiverInstruction,
    schedule: scheduleLabel(normalized.frequency, normalized.timeSgt),
    nextRun: nextRunLabel(normalized.frequency, normalized.timeSgt),
    status: "paused",
    trustPhrase: normalized.trustPhrase,
  };
}

export function addRoutine(routines: CareRoutine[], draft: RoutineDraft, senior: Senior | undefined, now = Date.now()): CareRoutine[] {
  if (hasRoutineDraftErrors(validateRoutineDraft(draft, senior))) return routines;
  return [...routines, routineFromDraft(draft, routines, now)];
}

/** The opening the agent is instructed to use, shown while the routine is being written. */
export function trustFirstOpening(preferredName: string, trustPhrase: string): string {
  const phrase = trustPhrase.trim() || "A caregiver asked me to call.";
  return `Hello ${preferredName}. I’m CareCall, an automated calling assistant. ${phrase} I will never ask for money, an OTP, or bank information.`;
}
