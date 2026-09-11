/**
 * Per party calling hours.
 *
 * A protocol that keeps dialling until it gets an answer will eventually ring
 * somebody at three in the morning. Every party carries a window in a declared
 * zone and the coordinator checks it before each call, including release calls:
 * a duty to tell somebody is not a licence to wake them.
 */

import type { CallingHours, CallingHoursInput } from "./types.js";

export const DEFAULT_CALLING_HOURS = { start: "09:00", end: "20:00" } as const;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class HoursError extends Error {}

export function parseClock(value: string, field: string): number {
  const match = HH_MM.exec(value);
  if (match === null) {
    throw new HoursError(`${field} must be a 24 hour HH:MM local time, got ${value}.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Resolve a party's window. A party that declares nothing gets 09:00 to 20:00 in
 * the meeting timezone, which is a floor rather than a guess: it is the widest
 * window this app will dial in without being told to.
 */
export function resolveCallingHours(
  input: CallingHoursInput | undefined,
  meetingTimezone: string,
  field: string,
): CallingHours {
  const start = input?.start ?? DEFAULT_CALLING_HOURS.start;
  const end = input?.end ?? DEFAULT_CALLING_HOURS.end;
  const timezone = input?.timezone ?? meetingTimezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new HoursError(`${field}.timezone must be an IANA name such as America/Los_Angeles, got ${timezone}.`);
  }
  const startMinutes = parseClock(start, `${field}.start`);
  const endMinutes = parseClock(end, `${field}.end`);
  if (startMinutes >= endMinutes) {
    throw new HoursError(
      `${field}.start must be earlier than ${field}.end. A window that wraps past midnight is refused rather than guessed.`,
    );
  }
  return { start, end, timezone, startMinutes, endMinutes };
}

/** Minutes since midnight at that instant, in that zone. Never the host zone. */
export function localMinutes(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantMs));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  // Intl writes midnight as 24 in some runtimes.
  return (hour % 24) * 60 + minute;
}

export function withinCallingHours(hours: CallingHours, instantMs: number): boolean {
  const minutes = localMinutes(instantMs, hours.timezone);
  return minutes >= hours.startMinutes && minutes < hours.endMinutes;
}

export function clockOf(instantMs: number, timezone: string): string {
  const minutes = localMinutes(instantMs, timezone);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
