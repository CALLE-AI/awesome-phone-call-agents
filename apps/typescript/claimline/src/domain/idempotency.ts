import { createHash } from "node:crypto";
import type { CallType } from "./types.js";

/**
 * Derive a STABLE idempotency key from the authorized intent, not from an
 * attempt. Retrying the same authorized call (same claim, type, destination,
 * and schema version) reuses the same key, so duplicate submissions collapse
 * to one call instead of dialing a person twice.
 */
export function deriveIdempotencyKey(input: {
  claimId: string;
  callType: CallType;
  /** Distinguishes calls to different contacts of the same claim + type. */
  contactId?: string | null;
  destinationPhone: string;
  schemaVersion: string;
  /** Retry generation. 0/undefined = original call; >0 = an explicit re-dial. */
  retryAttempt?: number;
}): string {
  const parts = [
    input.claimId,
    input.callType,
    input.contactId ?? "",
    input.destinationPhone.trim(),
    input.schemaVersion,
  ];
  // Only appended for explicit re-dials, so original keys stay unchanged.
  if (input.retryAttempt && input.retryAttempt > 0) {
    parts.push(`retry=${input.retryAttempt}`);
  }
  const canonical = parts.join("|");
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `claimline_${input.callType}_${digest.slice(0, 32)}`;
}
