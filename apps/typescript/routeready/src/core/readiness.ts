import type { Readiness } from "./types.js";

/**
 * What a verified answer means for the route. Times are minutes after shift
 * start. Buckets use their conservative end, so the rider is never sent early.
 */
export type StopPlan =
  | { kind: "no_change" }
  | { kind: "earliest"; at: number }
  | { kind: "revisit"; at: number | null }
  | { kind: "remove" };

/**
 * @param promisedEta the arrival time the customer was told on the call
 * @param now the time the answer was received
 * @param statedTime a clock time the customer named, in minutes after shift start
 */
export function planFromAnswer(
  readiness: Readiness,
  promisedEta: number,
  now: number,
  statedTime: number | null = null,
): StopPlan {
  switch (readiness) {
    case "ready_now":
      return { kind: "earliest", at: now };
    case "within_15_min":
      return { kind: "earliest", at: statedTime ?? promisedEta + 15 };
    case "15_to_45_min":
      return { kind: "earliest", at: statedTime ?? promisedEta + 45 };
    case "later_today":
      return { kind: "revisit", at: statedTime };
    case "not_today":
      return { kind: "remove" };
    case "unknown":
      return { kind: "no_change" };
  }
}

/** Converts "13:05" to minutes after the shift start; null when empty, malformed or before the shift. */
export function clockToMinutes(clock: string, shiftStart: string): number | null {
  const time = parseClock(clock);
  const start = parseClock(shiftStart);
  if (time === null || start === null || time < start) return null;
  return time - start;
}

/** Formats minutes after the shift start as a 24-hour clock time. */
export function minutesToClock(minutes: number, shiftStart: string): string {
  const total = Math.round((parseClock(shiftStart) ?? 0) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
