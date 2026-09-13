import type { CallStatus, Candidate, RecruiterDecision } from "@/lib/types";

export const STATUS_COPY = {
  ready: { label: "Ready", className: "bg-[rgba(47,107,79,0.12)] text-forest" },
  prompt_pending: {
    label: "Call script pending",
    className: "bg-[rgba(161,92,18,0.12)] text-warn",
  },
  resume_pending: {
    label: "Prepare resume",
    className: "bg-[rgba(161,92,18,0.12)] text-warn",
  },
  missing_resume: { label: "No resume link", className: "bg-[rgba(161,92,18,0.12)] text-warn" },
  needs_consent: { label: "Needs consent", className: "bg-[rgba(154,59,47,0.12)] text-danger" },
} as const;

export const CALL_COPY: Record<CallStatus, { label: string; className: string }> = {
  not_called: { label: "Not called", className: "text-muted" },
  queued: { label: "Queued", className: "text-forest" },
  calling: { label: "Calling", className: "text-warn" },
  talking: { label: "Talking", className: "text-forest" },
  completed: { label: "Completed", className: "text-forest" },
  no_answer: { label: "No answer", className: "text-warn" },
  failed: { label: "Failed", className: "text-danger" },
};

export const IN_FLIGHT_CALL_STATUSES: CallStatus[] = ["queued", "calling", "talking"];

export function isInFlightCall(status: CallStatus) {
  return status === "queued" || status === "calling" || status === "talking";
}

export function isLiveCall(status: CallStatus) {
  return status === "calling" || status === "talking";
}

export function isTerminalCall(status: CallStatus) {
  return status === "completed" || status === "no_answer" || status === "failed";
}

export function isScoringPending(row: Pick<Candidate, "callStatus" | "callResponse" | "calleCallId">) {
  if (!isTerminalCall(row.callStatus)) return false;
  if (!row.calleCallId && !row.callResponse) return false;
  return row.callResponse == null || row.callResponse.score == null;
}

export function isQueueBusy(candidates: Pick<Candidate, "callStatus" | "callResponse" | "calleCallId">[]) {
  return candidates.some((row) => isInFlightCall(row.callStatus) || isScoringPending(row));
}

export type QueueActivity = {
  kind: "talking" | "calling" | "scoring" | "queued";
  candidate: Candidate;
  remaining: number;
};

export function queueActivity(candidates: Candidate[]): QueueActivity | null {
  const remaining = candidates.filter((row) => row.callStatus === "queued").length;
  const talking = candidates.find((row) => row.callStatus === "talking");
  if (talking) return { kind: "talking", candidate: talking, remaining };
  const calling = candidates.find((row) => row.callStatus === "calling");
  if (calling) return { kind: "calling", candidate: calling, remaining };
  const scoring = candidates.find((row) => isScoringPending(row));
  if (scoring) return { kind: "scoring", candidate: scoring, remaining };
  const queued = candidates.find((row) => row.callStatus === "queued");
  if (queued) return { kind: "queued", candidate: queued, remaining: Math.max(0, remaining - 1) };
  return null;
}

export function canPlaceCall(
  candidate: Pick<Candidate, "consent" | "resumeUrl" | "resumeText" | "callPrompt" | "callStatus">,
) {
  return rosterStatus(candidate) === "ready" && !isInFlightCall(candidate.callStatus);
}

export function rosterStatus(
  candidate: Pick<Candidate, "consent" | "resumeUrl" | "resumeText" | "callPrompt">,
) {
  if (!candidate.consent) return "needs_consent" as const;
  if (!candidate.resumeUrl) return "missing_resume" as const;
  if (!candidate.resumeText) return "resume_pending" as const;
  if (!candidate.callPrompt) return "prompt_pending" as const;
  return "ready" as const;
}

export function shortBatchId(id: string) {
  return id.slice(0, 8);
}

export function formatCallClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };
  return {
    date: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

export function formatUploadedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function shortCalleId(id: string) {
  const value = id.trim();
  if (!value) return "";
  if (isDryRunCallId(value)) return "Dry-run (no live call)";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function isDryRunCallId(id: string) {
  return id.startsWith("dry-run:");
}

export const DECISION_COPY: Record<Exclude<RecruiterDecision, ""> | "pending", { label: string; className: string }> = {
  pending: { label: "No decision", className: "text-muted" },
  call_again: { label: "Call again needed", className: "text-warn" },
  next_round: { label: "Next round", className: "text-forest" },
  rejected: { label: "Rejected", className: "text-danger" },
};

export function formatCallDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function resumePreview(text: string, limit = 160) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}…`;
}
