import type { Tier } from "./scoring";

export const TIER_META: Record<Tier, { label: string; short: string; color: string; chip: string }> = {
  confirmed: { label: "Confirmed available", short: "Available", color: "#10b981", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial: { label: "Partial quantity", short: "Partial", color: "#f59e0b", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  alternative: { label: "Alternative available", short: "Alternative", color: "#0ea5e9", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  refused: { label: "Won't disclose by phone", short: "Undisclosed", color: "#8b5cf6", chip: "bg-violet-50 text-violet-700 ring-violet-200" },
  out: { label: "Not available", short: "Not available", color: "#f43f5e", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  unreached: { label: "Not reached", short: "Not reached", color: "#94a3b8", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  unknown: { label: "Unclear answer", short: "Unclear", color: "#94a3b8", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function newMissionId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Rough city driving estimate for planning only (about 22 km/h average door to door). */
export function driveMinutes(km: number): number {
  return Math.max(3, Math.round((km / 22) * 60));
}

/** Google Maps Platform terms forbid showing Places content on a non-Google map, so Google-sourced places are listed but never pinned. */
export function onMap(source: string): boolean {
  return source !== "google";
}

export function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
