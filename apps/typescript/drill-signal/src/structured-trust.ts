/**
 * Trust gate for CALL-E structured results used in drill outcome classification.
 */

import { parseStructuredResult } from "./schema.js";
import type { CallSnapshot, StructuredDrillResult } from "./types.js";
import { isTerminalCallStatus } from "./types.js";

/** Minimum completionConfidence.score required before a completed call's structured result is trusted. */
export const MIN_COMPLETION_CONFIDENCE_SCORE = 0.8;

export function rawStructuredFromSnapshot(snapshot: CallSnapshot): Record<string, unknown> | null {
  return snapshot.structuredResult ?? snapshot.recipients[0]?.structuredResult ?? null;
}

export function structuredFromSnapshot(snapshot: CallSnapshot): StructuredDrillResult | null {
  return parseStructuredResult(rawStructuredFromSnapshot(snapshot));
}

export function isStructuredResultTrusted(snapshot: CallSnapshot): boolean {
  if (snapshot.status.toLowerCase() !== "completed") {
    return false;
  }
  if (snapshot.taskCompleted !== true) {
    return false;
  }
  const score = snapshot.completionConfidence?.score;
  return typeof score === "number" && score >= MIN_COMPLETION_CONFIDENCE_SCORE;
}

export function acceptedStructuredFromSnapshot(snapshot: CallSnapshot): StructuredDrillResult | null {
  if (!isStructuredResultTrusted(snapshot)) {
    return null;
  }
  return structuredFromSnapshot(snapshot);
}

export function isCompletedSnapshotAmbiguous(snapshot: CallSnapshot): boolean {
  return isTerminalCallStatus(snapshot.status) && snapshot.status.toLowerCase() === "completed" && !isStructuredResultTrusted(snapshot);
}
