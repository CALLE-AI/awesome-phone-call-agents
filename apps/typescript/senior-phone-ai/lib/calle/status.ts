import { redactPhoneNumbers } from "../safety/phone";
import { followupEvidence, summaryEvidence, type FollowupEvidence, type SummaryEvidence } from "./followup-evidence";

export const CALLE_CALL_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
] as const;

export type CalleCallStatus = (typeof CALLE_CALL_STATUSES)[number] | "unknown";
export type CalleCallOutcome = "pending" | "completed" | "incomplete" | "failed" | "canceled" | "unknown";

export interface CalleTranscriptTurn {
  readonly id: string;
  readonly offsetSeconds: number;
  readonly speaker: "caller" | "assistant";
  readonly text: string;
}

export interface CalleCallSnapshot {
  readonly callId: string;
  readonly status: CalleCallStatus;
  readonly outcome: CalleCallOutcome;
  readonly createdAt?: string;
  readonly summary?: string;
  readonly taskCompleted?: boolean;
  readonly transcript: CalleTranscriptTurn[];
  readonly updatedAt: string;
  readonly postCallSearch?: FollowupEvidence;
  readonly postCallSummary?: SummaryEvidence;
  readonly followupRegistration?: "armed" | "registration_failed";
}

const CALL_ID = /^call_[A-Za-z0-9_-]{3,200}$/;
const MAX_TEXT_LENGTH = 2_000;

export function assertCalleCallId(value: string): string {
  if (!CALL_ID.test(value)) throw new Error("invalid CALL-E call ID");
  return value;
}

export function parseCalleCallIds(value: string | undefined, maximum = 20): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((item) => assertCalleCallId(item.trim())))].slice(0, maximum);
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = redactPhoneNumbers(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return text || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseCalleCallSnapshot(value: unknown, now = Date.now): CalleCallSnapshot {
  const root = record(value);
  if (!root || typeof root.id !== "string") throw new Error("invalid CALL-E response");
  const callId = assertCalleCallId(root.id);
  const status = typeof root.status === "string" && CALLE_CALL_STATUSES.includes(
    root.status as (typeof CALLE_CALL_STATUSES)[number],
  ) ? root.status as (typeof CALLE_CALL_STATUSES)[number] : "unknown";
  const taskCompleted = typeof root.task_completed === "boolean" ? root.task_completed : undefined;
  const outcome: CalleCallOutcome = status === "queued" || status === "in_progress"
    ? "pending"
    : status === "completed"
      ? taskCompleted === true ? "completed" : "incomplete"
      : status;
  const transcript: CalleTranscriptTurn[] = [];
  let evidenceAttempts = 0;

  for (const recipientValue of Array.isArray(root.recipients) ? root.recipients : []) {
    const recipient = record(recipientValue);
    for (const attemptValue of recipient && Array.isArray(recipient.attempts) ? recipient.attempts : []) {
      const attempt = record(attemptValue);
      if (attempt && Array.isArray(attempt.transcript_turns) && attempt.transcript_turns.length) evidenceAttempts++;
      for (const [index, turnValue] of (attempt && Array.isArray(attempt.transcript_turns)
        ? attempt.transcript_turns
        : []).entries()) {
        const turn = record(turnValue);
        const speaker = turn?.speaker === "bot"
          ? "assistant"
          : turn?.speaker === "user" ? "caller" : undefined;
        const text = boundedText(turn?.text);
        const offsetSeconds = typeof turn?.offset_seconds === "number" && Number.isFinite(turn.offset_seconds)
          ? Math.max(0, Math.round(turn.offset_seconds))
          : 0;
        if (speaker && text) {
          transcript.push({
            id: `${typeof attempt?.id === "string" ? attempt.id.slice(0, 100) : "attempt"}-${index}`,
            offsetSeconds,
            speaker,
            text,
          });
        }
      }
    }
  }

  return {
    callId,
    status,
    outcome,
    createdAt: typeof root.created_at === "string" && Number.isFinite(Date.parse(root.created_at))
      ? root.created_at
      : undefined,
    summary: boundedText(root.summary),
    taskCompleted,
    transcript,
    updatedAt: new Date(now()).toISOString(),
    postCallSearch: (() => {
      const parsed = followupEvidence.safeParse(record(root.structured_result)?.post_call_search);
      return parsed.success && evidenceAttempts === 1 && Object.values(parsed.data).every((value) => redactPhoneNumbers(value) === value) ? parsed.data : undefined;
    })(),
    postCallSummary: (() => {
      const parsed = summaryEvidence.safeParse(record(root.structured_result)?.post_call_summary);
      return parsed.success && evidenceAttempts === 1 && Object.values(parsed.data).every((value) => redactPhoneNumbers(value) === value) ? parsed.data : undefined;
    })(),
  };
}
