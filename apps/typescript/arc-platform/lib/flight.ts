/**
 * Flight dates.
 *
 * The brief captures a start date and a duration in days; the end is always
 * derived from those two. Two date fields could contradict the duration chip
 * sitting beside them, and the chip is what the AI generation prompt reads.
 *
 * Everything here works in plain yyyy-mm-dd strings and local time. Date's
 * toISOString() converts to UTC, which hands back yesterday for anyone east of
 * Greenwich - which is every user of this product.
 */

/**
 * A flight date is a calendar date, not an instant. Stored at UTC midnight and
 * always formatted in UTC, so "1 September" reads as 1 September on a Karachi
 * laptop and on a UTC server alike. Local midnight would be stored as the
 * previous day in UTC and render off by one wherever the page is server-side
 * rendered - which campaign detail is.
 */
export function toUTCDate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Renders a stored flight date. UTC, to match how it was written. */
export function formatFlightDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-PK", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/** Local-midnight yyyy-mm-dd for a Date. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * Last day of the flight, inclusive: a 7-day flight starting Monday the 1st
 * runs to Sunday the 7th, not the 8th.
 */
export function flightEndISO(startISO: string, durationDays: number): string | null {
  if (!startISO) return null;
  const [y, m, d] = startISO.split("-").map(Number);
  if (!y || !m || !d) return null;
  const end = new Date(y, m - 1, d + Math.max(1, durationDays) - 1);
  return Number.isNaN(end.getTime()) ? null : toISODate(end);
}

/** "7 September 2026" - for the hint under the date field. */
export function flightEndLabel(startISO: string, durationDays: number): string {
  const iso = flightEndISO(startISO, durationDays);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
