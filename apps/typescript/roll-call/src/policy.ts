import type { Absence, Guardian, SchoolConfig } from "./types.js";

export interface PolicyVerdict {
  allowed: boolean;
  reason: string | null;
}

/** Returns "HH:MM" local time for `now` in the school's time zone. */
export function localClock(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

export function withinCallingWindow(now: Date, school: SchoolConfig): boolean {
  const clock = localClock(now, school.timeZone);
  return clock >= school.callingWindow.start && clock < school.callingWindow.end;
}

/**
 * Decides whether one guardian may be dialled for one absence. Every refusal
 * carries the reason so the report can print it. A guardian is refused, never
 * silently skipped.
 */
export function mayCallGuardian(
  guardian: Guardian,
  guardianIndex: number,
  absence: Absence,
  school: SchoolConfig,
  now: Date,
): PolicyVerdict {
  if (!guardian.automatedCallsConsent) {
    return { allowed: false, reason: "guardian has not consented to automated attendance calls" };
  }
  if (school.doNotCall.includes(guardian.phone)) {
    return { allowed: false, reason: "number is on the school do-not-call list" };
  }
  if (guardianIndex >= school.maxGuardiansPerStudent) {
    return {
      allowed: false,
      reason: `cascade limit of ${school.maxGuardiansPerStudent} guardian(s) per student reached`,
    };
  }
  if (!withinCallingWindow(now, school)) {
    return {
      allowed: false,
      reason: `outside calling window ${school.callingWindow.start}-${school.callingWindow.end} ${school.timeZone}`,
    };
  }
  if (absence.guardians[guardianIndex] !== guardian) {
    return { allowed: false, reason: "guardian is not listed for this absence" };
  }
  return { allowed: true, reason: null };
}
