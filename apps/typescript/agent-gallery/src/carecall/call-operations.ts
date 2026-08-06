import type { CareCallResult } from "../workflows/carecall";

export type CareCallJobState = "queued" | "starting" | "ongoing" | "completed" | "cancelled" | "needs_review";
export type CareCallListView = "all" | "queue" | "active" | "history" | "needs_review";

export interface CareCallListItem {
  job_id: string;
  run_id?: string;
  source: "manual" | "schedule";
  status: CareCallJobState;
  provider_status?: string;
  senior: { id: string; preferred_name: string };
  routine: { id: string; title: string; kind: "medication" | "meal" };
  scheduled_for: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  duration_source?: "provider" | "observed";
  queue_position?: number;
  failure_reason?: string;
  result?: CareCallResult;
}

export interface CareCallListPayload {
  jobs: CareCallListItem[];
  stats: { total: number; queued: number; active: number; needs_review: number; completed_today: number };
  next_cursor: string | null;
  total_matching: number;
  scan_truncated: boolean;
  generated_at: string;
  error?: string;
}

export function formatCallDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "Not available";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remaining}s`;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${remaining}s`;
}

export function formatCallTime(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function callStateLabel(item: CareCallListItem, now = Date.now()): string {
  if (item.status === "queued") {
    if (Date.parse(item.scheduled_for) > now + 1000) return "Scheduled";
    return item.queue_position ? `Waiting · position ${item.queue_position}` : "Waiting";
  }
  if (item.status === "starting") return "Starting";
  if (item.status === "ongoing") return item.provider_status?.replaceAll("_", " ").toLowerCase() || "Ongoing";
  if (item.status === "completed") return item.result?.outcome_label ?? "Completed";
  if (item.status === "needs_review") return "Needs review";
  return "Cancelled";
}

export function callStateTone(item: CareCallListItem): "neutral" | "accent" | "success" | "attention" {
  if (item.status === "completed" && !item.result?.follow_up_required) return "success";
  if (item.status === "needs_review" || item.result?.follow_up_required) return "attention";
  if (item.status === "starting" || item.status === "ongoing") return "accent";
  return "neutral";
}

export function elapsedCallSeconds(item: CareCallListItem, now = Date.now()): number | undefined {
  if (item.duration_seconds !== undefined) return item.duration_seconds;
  if (!item.started_at || (item.status !== "starting" && item.status !== "ongoing")) return undefined;
  const started = Date.parse(item.started_at);
  return Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : undefined;
}
