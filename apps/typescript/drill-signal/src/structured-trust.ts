/**
 * Trust gate for CALL-E structured results used in drill outcome classification.
 *
 * Conservative rules:
 * - Examine top-level structuredResult before recipient-level fallback.
 * - Trust a completed call's structured result only when taskCompleted is true
 *   and completionConfidence.score meets MIN_COMPLETION_CONFIDENCE_SCORE.
 * - Failed terminals must inspect failure codes, structured payloads, and
 *   transcript evidence before any backup-eligible classification.
 */

import { parseStructuredResult } from "./schema.js";
import type { CallOutcomeKind, CallSnapshot, StructuredDrillResult } from "./types.js";
import { isTerminalCallStatus } from "./types.js";

/** Minimum completionConfidence.score required before a completed call's structured result is trusted. */
export const MIN_COMPLETION_CONFIDENCE_SCORE = 0.8;

export function rawStructuredFromSnapshot(snapshot: CallSnapshot): Record<string, unknown> | null {
  // Top-level first; recipient is fallback only when top-level is absent.
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

export function collectFailureCodes(snapshot: CallSnapshot): string[] {
  const codes: string[] = [];
  if (snapshot.failureCode) {
    codes.push(snapshot.failureCode.toLowerCase());
  }
  for (const recipient of snapshot.recipients) {
    if (recipient.status) {
      // status strings are not failure codes; skip
    }
    for (const attempt of recipient.attempts) {
      if (attempt.failureCode) {
        codes.push(attempt.failureCode.toLowerCase());
      }
    }
  }
  return codes;
}

/** Map definitive provider unavailable codes to a backup-eligible outcome, or null. */
export function definitiveUnavailableOutcome(codes: string[]): CallOutcomeKind | null {
  const normalized = codes.map((code) => code.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  if (normalized.length === 0) {
    return null;
  }
  const voicemailCodes = new Set(["voicemail", "voicemail_detected", "recipient_voicemail"]);
  if (normalized.some((code) => voicemailCodes.has(code))) {
    return "voicemail";
  }
  // Only explicit unavailable codes may escalate. Substring matches are avoided
  // so an unknown code such as "busybox_internal_error" remains ambiguous.
  const unavailableCodes = new Set([
    "no_answer",
    "noanswer",
    "recipient_no_answer",
    "call_no_answer",
    "busy",
    "user_busy",
    "recipient_busy",
  ]);
  if (normalized.some((code) => unavailableCodes.has(code))) {
    return "no_answer";
  }
  return null;
}

export function structuredSuggestsLiveContact(result: StructuredDrillResult | null): boolean {
  if (result === null) {
    return false;
  }
  return (
    result.reached_live_person === true ||
    result.acknowledged_scenario === true ||
    result.can_take_ownership === true ||
    result.opt_out === true
  );
}

/** True when user speech suggests a live person engaged (not a no-answer/voicemail marker). */
export function hasUserTranscriptEvidence(snapshot: CallSnapshot): boolean {
  for (const recipient of snapshot.recipients) {
    for (const attempt of recipient.attempts) {
      for (const turn of attempt.transcriptTurns) {
        if (turn.speaker !== "user") {
          continue;
        }
        const text = turn.text.trim();
        if (text.length === 0) {
          continue;
        }
        const lower = text.toLowerCase();
        // Simulation/provider markers that confirm unavailability are not contact evidence.
        if (
          lower.includes("no answer") ||
          lower.includes("no-answer") ||
          lower.includes("voicemail") ||
          lower.includes("not available") ||
          lower.includes("user busy") ||
          /\bbusy\b/.test(lower)
        ) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * Classify a failed terminal snapshot using all available evidence.
 * Only definitive unavailable/no-answer/busy/voicemail without conflicting
 * contact evidence may return a non-ambiguous backup-eligible outcome.
 */
export function classifyFailedSnapshot(snapshot: CallSnapshot): {
  outcome: CallOutcomeKind;
  ambiguous: boolean;
  reason: "conflicting_evidence" | "incomplete_evidence" | null;
} {
  const topLevel = parseStructuredResult(snapshot.structuredResult);
  const recipientLevel = parseStructuredResult(snapshot.recipients[0]?.structuredResult ?? null);
  const codes = collectFailureCodes(snapshot);
  const definitive = definitiveUnavailableOutcome(codes);
  const contactSuggested =
    structuredSuggestsLiveContact(topLevel) ||
    structuredSuggestsLiveContact(recipientLevel) ||
    hasUserTranscriptEvidence(snapshot);

  if (contactSuggested) {
    // Failed terminal with live-contact signals — never escalate on conflict.
    return { outcome: "unknown", ambiguous: true, reason: "conflicting_evidence" };
  }

  if (definitive !== null) {
    return { outcome: definitive, ambiguous: false, reason: null };
  }

  // Missing/unclassified failure codes or incomplete provider evidence.
  return { outcome: "unknown", ambiguous: true, reason: "incomplete_evidence" };
}
