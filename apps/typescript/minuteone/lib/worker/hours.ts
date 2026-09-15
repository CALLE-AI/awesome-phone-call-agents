import type { BusinessHours } from "../config/schema";

const DAY_MAP: Record<string, BusinessHours["days"][number]> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export function isWithinBusinessHours(hours: BusinessHours, now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = DAY_MAP[parts.find((p) => p.type === "weekday")?.value ?? ""];
  if (!weekday || !hours.days.includes(weekday)) return false;

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const nowMinutes = hour * 60 + minute;

  const [startH, startM] = hours.start.split(":").map(Number);
  const [endH, endM] = hours.end.split(":").map(Number);

  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM;
}
