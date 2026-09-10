import { redactPhoneNumbers } from "../safety/phone";

export const CALLE_CALL_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
] as const;

export type CalleCallStatus = (typeof CALLE_CALL_STATUSES)[number] | "unknown";

export interface CalleTranscriptTurn {
  readonly id: string;
  readonly offsetSeconds: number;
  readonly speaker: "caller" | "assistant";
  readonly text: string;
}

export interface CalleCallSnapshot {
  readonly callId: string;
  readonly status: CalleCallStatus;
  readonly summary?: string;
  readonly taskCompleted?: boolean;
  readonly transcript: CalleTranscriptTurn[];
  readonly updatedAt: string;
}

const CALL_ID = /^call_[A-Za-z0-9_-]{3,200}$/;
const MAX_TEXT_LENGTH = 2_000;

export function assertCalleCallId(value: string): string {
  if (!CALL_ID.test(value)) throw new Error("invalid CALL-E call ID");
  return value;
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
  const transcript: CalleTranscriptTurn[] = [];

  for (const recipientValue of Array.isArray(root.recipients) ? root.recipients : []) {
    const recipient = record(recipientValue);
    for (const attemptValue of recipient && Array.isArray(recipient.attempts) ? recipient.attempts : []) {
      const attempt = record(attemptValue);
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
    summary: boundedText(root.summary),
    taskCompleted: typeof root.task_completed === "boolean" ? root.task_completed : undefined,
    transcript,
    updatedAt: new Date(now()).toISOString(),
  };
}
