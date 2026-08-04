/**
 * Presentation helpers for operator-facing times.
 *
 * These only change how a value reads, never what it means. The form collects
 * wall-clock times in the business's own timezone, so a value like
 * "2026-08-07T10:00" is rendered as the ten o'clock the operator typed and is
 * never shifted into another zone; the zone is stated alongside it as text
 * instead. Converting here would silently move appointments.
 *
 * Anything unparseable is returned unchanged rather than replaced with a
 * guess, so a malformed value stays visible instead of becoming a plausible
 * wrong time.
 */

/** True when a datetime string carries no offset, i.e. it is a wall clock. */
function isWallClock(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
}

function parse(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(date: Date, options: Intl.DateTimeFormatOptions): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return null;
  }
}

/** "Fri 7 Aug, 10:00 am" — or the original string if it cannot be read. */
export function formatDateTime(value: string): string {
  const date = parse(value);
  if (!date) return value;

  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  // A wall clock is rendered in the browser's zone, which is where the parsed
  // value already sits, so no shift occurs.
  if (!isWallClock(value)) options.timeZoneName = "short";

  return formatWith(date, options) ?? value;
}

/** "10:00 am" — the time alone, for the second half of a same-day range. */
function formatTimeOnly(value: string): string {
  const date = parse(value);
  if (!date) return value;
  return formatWith(date, { hour: "numeric", minute: "2-digit" }) ?? value;
}

function sameDay(a: string, b: string): boolean {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return false;
  return left.toDateString() === right.toDateString();
}

/** "Fri 7 Aug, 10:00 am – 12:00 pm", collapsing the date when it repeats. */
export function formatWindow(start: string, end: string): string {
  if (!start || !end) return [start, end].filter(Boolean).join(" – ") || "Not set";
  const tail = sameDay(start, end) ? formatTimeOnly(end) : formatDateTime(end);
  return `${formatDateTime(start)} – ${tail}`;
}

/** "1:23" — elapsed call time, zero-padded so the width never jumps. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "14:32:07" — the clock time of a transcript entry. */
export function formatTimestamp(value: string): string {
  const date = parse(value);
  if (!date) return "";
  return formatWith(date, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) ?? "";
}

/** "no_agreement" -> "No agreement". Outcome ids are snake_case in the contract. */
export function humanizeOutcome(outcome: string): string {
  const spaced = outcome.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
