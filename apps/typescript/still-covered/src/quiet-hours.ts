// Calling windows. A welfare call at 3 a.m. frightens people; Canopy refuses to start a roll call
// inside the quiet window unless the playbook is life-safety and the operator overrides with a
// recorded reason. Pure functions over a clock value and an IANA time zone.

export interface QuietWindow {
  /** Minutes after local midnight when quiet hours begin, e.g. 21:00 -> 1260. */
  startMinutes: number;
  /** Minutes after local midnight when quiet hours end, e.g. 07:00 -> 420. May be before start (wraps midnight). */
  endMinutes: number;
}

export function parseQuietHours(text: string): QuietWindow | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === "none" || trimmed === "off") {
    return null;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Quiet hours must look like 21:00-07:00, got ${text}`);
  }
  const [, sh, sm, eh, em] = match;
  const start = Number(sh) * 60 + Number(sm);
  const end = Number(eh) * 60 + Number(em);
  if (Number(sh) > 23 || Number(eh) > 23 || Number(sm) > 59 || Number(em) > 59) {
    throw new Error(`Quiet hours out of range: ${text}`);
  }
  return { startMinutes: start, endMinutes: end };
}

/** Minutes after midnight in the given time zone. */
export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

export function isQuietNow(date: Date, window: QuietWindow | null, timeZone: string): boolean {
  if (window === null) {
    return false;
  }
  const now = localMinutes(date, timeZone);
  if (window.startMinutes === window.endMinutes) {
    return false;
  }
  if (window.startMinutes < window.endMinutes) {
    return now >= window.startMinutes && now < window.endMinutes;
  }
  return now >= window.startMinutes || now < window.endMinutes;
}

/** Minutes until the quiet window ends, or 0 when not quiet. */
export function minutesUntilQuietEnds(date: Date, window: QuietWindow | null, timeZone: string): number {
  if (!isQuietNow(date, window, timeZone) || window === null) {
    return 0;
  }
  const now = localMinutes(date, timeZone);
  return ((window.endMinutes - now) % 1440 + 1440) % 1440 || 1440;
}

export function formatWindow(window: QuietWindow | null): string {
  if (window === null) {
    return "none";
  }
  const f = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${f(window.startMinutes)}-${f(window.endMinutes)}`;
}

export function resolveTimeZone(candidate: string | undefined): string {
  const tz = (candidate ?? "").trim();
  if (tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      throw new Error(`Unknown time zone: ${tz}`);
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
