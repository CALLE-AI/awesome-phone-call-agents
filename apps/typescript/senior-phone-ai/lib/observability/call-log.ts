import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { maskPhoneNumber } from "../safety/phone";

const logPath = join(process.cwd(), "logs", "call-activity.ndjson");

const EVENTS = [
  "schedule_created",
  "schedule_canceled",
  "schedule_expired",
  "dispatch_claimed",
  "provider_request_started",
  "provider_accepted",
  "provider_rejected",
  "provider_outcome_unknown",
  "provider_request_failed",
] as const;

type CallLogEvent = (typeof EVENTS)[number];

export interface CallLogInput {
  readonly destinationE164?: string;
  readonly durationMs?: number;
  readonly event: CallLogEvent;
  readonly providerCode?: string;
  readonly requestId: string;
  readonly scheduledFor?: string;
  readonly source?: "provider" | "registry";
}

export interface CallLogEntry {
  readonly at: string;
  readonly destination?: string;
  readonly durationMs?: number;
  readonly event: CallLogEvent;
  readonly providerCode?: string;
  readonly requestReference: string;
  readonly scheduledFor?: string;
  readonly source?: "provider" | "registry";
}

function boundedCode(value: string): string | undefined {
  const code = value.replace(/[^a-z0-9_.-]/giu, "_").slice(0, 80);
  return code || undefined;
}

export function callFailureCode(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "AbortError") return "timeout";
  if (!(cause instanceof Error)) return "unknown_error";
  const providerCode = "providerCode" in cause ? cause.providerCode : undefined;
  if (typeof providerCode === "string") return boundedCode(providerCode)?.toLowerCase() ?? "provider_error";
  const httpStatus = /^CALL-E create status ([0-9]{3})$/.exec(cause.message)?.[1];
  if (httpStatus) return `http_${httpStatus}`;
  if (cause.message === "CALL-E redirect rejected") return "redirect_rejected";
  const nestedCode = typeof cause.cause === "object" && cause.cause !== null && "code" in cause.cause
    ? (cause.cause as { code?: unknown }).code
    : undefined;
  if (typeof nestedCode === "string") return boundedCode(nestedCode)?.toLowerCase() ?? "network_error";
  return boundedCode(cause.name)?.toLowerCase() ?? "unknown_error";
}

export function createCallLogEntry(input: CallLogInput, at = new Date().toISOString()): CallLogEntry {
  if (!EVENTS.includes(input.event)) throw new Error("invalid call log event");
  if (!input.requestId) throw new Error("call log request identifier is required");
  if (!Number.isFinite(Date.parse(at))) throw new Error("invalid call log timestamp");
  if (input.durationMs !== undefined && (!Number.isInteger(input.durationMs) || input.durationMs < 0)) {
    throw new Error("invalid call log duration");
  }
  if (input.scheduledFor !== undefined && !Number.isFinite(Date.parse(input.scheduledFor))) {
    throw new Error("invalid scheduled call log timestamp");
  }

  return {
    at,
    destination: input.destinationE164 ? maskPhoneNumber(input.destinationE164) : undefined,
    durationMs: input.durationMs,
    event: input.event,
    providerCode: input.providerCode ? boundedCode(input.providerCode) : undefined,
    requestReference: createHash("sha256").update(input.requestId).digest("hex").slice(0, 12),
    scheduledFor: input.scheduledFor,
    source: input.source,
  };
}

export async function writeCallLog(input: CallLogInput): Promise<void> {
  try {
    const entry = createCallLogEntry(input);
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    console.error("[call-scheduler] Failed to write safe diagnostic log entry");
  }
}
