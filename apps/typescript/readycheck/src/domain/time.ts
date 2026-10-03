import { Temporal } from '@js-temporal/polyfill';
export function isTimeZone(zone: string) {
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}
export function localToInstant(value: string, timeZone: string): string {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timeZone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
export function instantToLocal(value: string, timeZone: string): string {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}
export function nextDate(timeZone = 'America/Chicago', now = new Date()): string {
  let date = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: 2 });
  while (date.dayOfWeek !== 5) date = date.add({ days: 1 });
  return date.toString();
}
export function formatTime(value: string, timeZone: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(d);
}
