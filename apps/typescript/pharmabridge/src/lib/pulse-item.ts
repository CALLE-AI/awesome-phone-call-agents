// Shortage Pulse vocabulary shared by the browser and the server: which item a need maps to, what a
// sighting holds, and how long an answer stays fresh enough to skip a call.
import { BLOOD_COMPONENTS, type BloodRequest, type Medication, type NeedKind } from "./types";

export interface PulseItem {
  key: string;
  label: string;
  controlled: boolean;
}

export type SightingStatus = "available" | "partial" | "alternative" | "out" | "refused";

/** One answer a PharmaBridge call heard, stripped of patient data, staff names, and quotes. */
export interface Sighting {
  id: string;
  kind: NeedKind;
  item: PulseItem;
  /** Null when withheld: PharmaBridge never publishes where a controlled medication is in stock. */
  facilityId: string | null;
  facilityName: string | null;
  lat: number;
  lon: number;
  status: SightingStatus;
  quantity: string;
  restock: string;
  observedAt: string;
  live: boolean;
}

export interface PulseSummary {
  answers: number;
  available: number;
  partial: number;
  alternative: number;
  out: number;
  refused: number;
  withheld: number;
  restock: string[];
  newestAt: string | null;
}

export interface PulseItemRow {
  item: PulseItem;
  kind: NeedKind;
  summary: PulseSummary;
}

export interface PulseResponse {
  sightings: Sighting[];
  summary: PulseSummary;
  items: PulseItemRow[];
  avoided: number;
}

export function medicationItem(med: Medication): PulseItem {
  return { key: `rx:${med.rxcui ?? med.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: med.name, controlled: med.controlled };
}

export function bloodItem(blood: BloodRequest): PulseItem {
  return { key: `blood:${blood.group}:${blood.component}`, label: `${blood.group} ${BLOOD_COMPONENTS[blood.component]}`, controlled: false };
}

/** Stock moves fast and blood faster; a "not here" answer stays useful for a day. */
export function freshHours(kind: NeedKind, status: SightingStatus): number {
  if (status === "out" || status === "refused") return 24;
  return kind === "blood_bank" ? 6 : 12;
}

/** Answers that make a repeat call pointless until they expire. */
export const SKIP_STATUSES: ReadonlyArray<SightingStatus> = ["out", "refused"];

export const SIGHTING_META: Record<SightingStatus, { label: string; color: string; chip: string }> = {
  available: { label: "Had it", color: "#10b981", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial: { label: "Had some", color: "#f59e0b", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  alternative: { label: "Other strength only", color: "#0ea5e9", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  out: { label: "Out of stock", color: "#f43f5e", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  refused: { label: "Won't say by phone", color: "#8b5cf6", chip: "bg-violet-50 text-violet-700 ring-violet-200" },
};

export function ageLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
