const JAKARTA = "Asia/Jakarta";

export function idr(amount: number): string {
  return `IDR ${Math.round(amount).toLocaleString("en-US")}`;
}

/** How the voice agent should say an amount. */
export function spokenRupiah(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} rupiah`;
}

export function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minutes`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minutes`;
}

/** Returns the ISO string with the Jakarta offset preserved for display. */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
