import { z } from "zod";

const localDate = /^\d{4}-\d{2}-\d{2}$/;
const localTime = /^([01]\d|2[0-3]):[0-5]\d$/;

export const LocalDateSchema = z
  .string()
  .regex(localDate, "Use YYYY-MM-DD")
  .refine(isRealCalendarDate, "Use a real calendar date");

export const LocalTimeSchema = z.string().regex(localTime, "Use 24-hour HH:MM");

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(isIanaTimeZone, "Use a valid IANA time zone");

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
