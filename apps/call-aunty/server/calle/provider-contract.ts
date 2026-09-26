import { CalleRemoteError } from "./errors";
import type { CallEventPage, CallTask } from "./runtime-types";

const PROVIDER_STATUSES = new Set<CallTask["status"]>([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
]);

function invalid(message: string): never {
  throw new CalleRemoteError(`CALL-E provider contract violation: ${message}`, 502);
}

export function isKnownProviderStatus(value: unknown): value is CallTask["status"] {
  return typeof value === "string" && PROVIDER_STATUSES.has(value as CallTask["status"]);
}

/** Validates provider call envelopes before they are persisted or treated as known state. */
export function assertProviderCallContract(value: unknown): asserts value is CallTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("call payload is not an object");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) invalid("call payload is missing id");
  if (!isKnownProviderStatus(record.status)) invalid("call payload has an unknown status");
  if (record.object !== undefined && record.object !== "call_task") invalid("call payload has an unexpected object type");
  if (record.completion_confidence !== undefined && record.completion_confidence !== null) {
    const confidence = record.completion_confidence;
    if (typeof confidence !== "object" || Array.isArray(confidence)) invalid("completion confidence is malformed");
    const score = Number((confidence as Record<string, unknown>).score);
    if (!Number.isFinite(score) || score < 0 || score > 1) invalid("completion confidence score is out of range");
  }
}

/** Validates that event responses are list-shaped and every event has a stable id/type. */
export function assertProviderEventPageContract(value: unknown): asserts value is CallEventPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("event payload is not an object");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.data)) invalid("event payload is missing data array");
  for (const event of record.data) {
    if (!event || typeof event !== "object" || Array.isArray(event)) invalid("event item is not an object");
    const item = event as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim()) invalid("event item is missing id");
    if (typeof item.type !== "string" || !item.type.trim()) invalid("event item is missing type");
  }
}
