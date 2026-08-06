import type { CareCallRequest } from "./types";

const E164 = /^\+[1-9]\d{7,14}$/;
const PERMITTED_CALL_WINDOW = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

/**
 * An unparsable window fails closed and blocks every call for that senior, so
 * anything that lets an operator change a window must check the format first
 * rather than discovering it when a reminder silently stops going out.
 */
export function isPermittedCallWindowFormat(windowText: string): boolean {
  return PERMITTED_CALL_WINDOW.test(windowText.trim());
}

function minutesFromClock(hourText: string, minuteText: string, meridiem: string): number {
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(minuteText);
}

/**
 * Minutes past midnight for each end of a permitted window, or null when the
 * text does not parse. Anything that renders or builds a window reads it
 * through here so a second copy of the pattern cannot drift from this one.
 */
export function permittedCallWindowMinutes(windowText: string): { start: number; end: number } | null {
  const match = windowText.trim().match(PERMITTED_CALL_WINDOW);
  if (!match) return null;
  return {
    start: minutesFromClock(match[1], match[2], match[3]),
    end: minutesFromClock(match[4], match[5], match[6]),
  };
}

function coversMinute(windowText: string, current: number): boolean {
  const window = permittedCallWindowMinutes(windowText);
  if (!window) return false;
  const { start, end } = window;
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

function withinPermittedWindow(windowText: string, instant: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return coversMinute(windowText, hour * 60 + minute);
}

export function isScheduledTimeWithinPermittedWindow(windowText: string, timeText: string): boolean {
  const timeMatch = timeText.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!timeMatch) return false;
  return coversMinute(windowText, Number(timeMatch[1]) * 60 + Number(timeMatch[2]));
}

export function validateCareCallRequest(
  request: CareCallRequest,
  now = new Date(),
  options: { enforceCurrentCallWindow?: boolean; enforceCurrentAuthorization?: boolean } = {},
): string[] {
  const errors: string[] = [];
  if (request.workflow !== "carecall") errors.push("workflow must be carecall");
  if (!request.request_key?.trim()) errors.push("request_key is required");
  else if (!/^[A-Za-z0-9:._-]{1,240}$/.test(request.request_key)) errors.push("request_key format is invalid");
  if (!request.organisation?.name?.trim()) errors.push("organisation name is required");
  if (request.organisation?.timezone !== "Asia/Singapore") errors.push("timezone must be Asia/Singapore");
  if (!request.senior?.preferred_name?.trim()) errors.push("senior preferred name is required");
  if (!E164.test(request.senior?.phone_e164 ?? "")) errors.push("senior phone must be E.164");
  if (request.senior?.language !== "English") errors.push("only verified English calls are enabled");
  if (request.senior?.authority_confirmed !== true) errors.push("contact authority must be confirmed");
  if (!request.senior?.permitted_call_window?.trim()) errors.push("permitted call window is required");
  if (!request.routine?.id?.trim()) errors.push("routine id is required");
  if (!request.routine?.title?.trim()) errors.push("routine title is required");
  if (!request.routine?.caregiver_instruction?.trim()) errors.push("caregiver instruction is required");
  if (!request.routine?.caregiver_name?.trim()) errors.push("caregiver name is required");
  if (!request.routine?.trust_phrase?.trim()) errors.push("trust phrase is required");
  if (!(["medication", "meal"] as const).includes(request.routine?.kind)) errors.push("routine kind is invalid");
  if (request.authorization?.exactly_one_call !== true) errors.push("exactly one call must be authorized");
  const authorizedAt = Date.parse(request.authorization?.authorized_at ?? "");
  if (!request.authorization?.authorized_at || Number.isNaN(authorizedAt)) {
    errors.push("authorization timestamp is invalid");
  } else {
    if (options.enforceCurrentAuthorization !== false && Math.abs(now.getTime() - authorizedAt) > 5 * 60_000) errors.push("authorization must be current");
    if (options.enforceCurrentCallWindow !== false && request.senior?.permitted_call_window && !withinPermittedWindow(request.senior.permitted_call_window, now)) {
      errors.push("current time is outside the senior's permitted call window");
    }
  }
  return errors;
}
