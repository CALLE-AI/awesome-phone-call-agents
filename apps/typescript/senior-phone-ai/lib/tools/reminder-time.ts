import { isIanaTimezone } from "./discovery";

export type ReminderTimeResolution =
  | Readonly<{ status: "ready"; scheduledFor: string; timezone: string }>
  | Readonly<{ status: "needs_clarification"; message: string }>;

interface LocalDateTime {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localParts(date: Date, timezone: string): LocalDateTime & { weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
  }).formatToParts(date);
  const text = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: Number(text("day")),
    hour: Number(text("hour")),
    minute: Number(text("minute")),
    month: Number(text("month")),
    weekday: text("weekday").toLowerCase(),
    year: Number(text("year")),
  };
}

function matchingInstants(target: LocalDateTime, timezone: string): Date[] {
  const approximate = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const matches: Date[] = [];
  for (let offsetMinutes = -16 * 60; offsetMinutes <= 16 * 60; offsetMinutes += 1) {
    const candidate = new Date(approximate + offsetMinutes * 60_000);
    const local = localParts(candidate, timezone);
    if (local.year === target.year && local.month === target.month && local.day === target.day
      && local.hour === target.hour && local.minute === target.minute) {
      matches.push(candidate);
    }
  }
  return matches;
}

function addLocalDays(local: LocalDateTime, days: number): LocalDateTime {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    day: shifted.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

function parseClock(hourText: string, minuteText: string | undefined, meridiem: string | undefined) {
  let hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < (meridiem ? 1 : 0)) return undefined;
  if (meridiem) {
    hour %= 12;
    if (meridiem.toLowerCase() === "pm") hour += 12;
  }
  return { hour, minute };
}

export function resolveReminderTime(
  text: string,
  timezone: string,
  now = new Date(),
): ReminderTimeResolution {
  if (!isIanaTimezone(timezone)) {
    return { status: "needs_clarification", message: "Which IANA timezone should I use?" };
  }
  const normalized = text.trim().toLowerCase();
  const match = /^(?:(\d{4})-(\d{2})-(\d{2})|((?:sun|mon|tues|wednes|thurs|fri|satur)day))\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(normalized);
  if (!match) {
    return { status: "needs_clarification", message: "Please give a date, time, AM or PM, and timezone." };
  }
  const unsignedHour = Number(match[5]);
  if (!match[7] && unsignedHour >= 1 && unsignedHour <= 12) {
    return { status: "needs_clarification", message: "Should that time be AM or PM?" };
  }
  const clock = parseClock(match[5]!, match[6], match[7]);
  if (!clock) return { status: "needs_clarification", message: "Please give a valid time." };

  let target: LocalDateTime;
  if (match[1] && match[2] && match[3]) {
    target = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), ...clock };
  } else {
    const current = localParts(now, timezone);
    const wanted = WEEKDAYS.indexOf(match[4]!);
    const currentDay = WEEKDAYS.indexOf(current.weekday);
    let days = (wanted - currentDay + 7) % 7;
    target = addLocalDays({ ...current, ...clock }, days);
    const candidates = matchingInstants(target, timezone);
    if (days === 0 && candidates.every((candidate) => candidate.getTime() <= now.getTime())) {
      days = 7;
      target = addLocalDays({ ...current, ...clock }, days);
    }
  }

  const candidates = matchingInstants(target, timezone);
  if (candidates.length === 0) {
    return { status: "needs_clarification", message: "That local time does not exist because the clock changes. Choose another time." };
  }
  if (candidates.length > 1) {
    return { status: "needs_clarification", message: "That local time occurs twice because the clock changes. Which occurrence do you mean?" };
  }
  if (candidates[0]!.getTime() <= now.getTime()) {
    return { status: "needs_clarification", message: "That time is in the past. Choose a future time." };
  }
  return { scheduledFor: candidates[0]!.toISOString(), status: "ready", timezone };
}
