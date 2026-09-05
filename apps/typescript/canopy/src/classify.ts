// Fail-closed classification. The voice agent proposes a tier; Canopy decides.
//
// Rules, in order:
//   1. Nobody was reached (failed recipient, voicemail, IVR, no completed attempt) -> unreachable.
//   2. A completed call with no usable structured result -> unverified. Never green.
//   3. Any red flag in the agent's own fields overrides a softer agent tier upward.
//   4. Green requires every signal to agree: cool, hydrated, no symptoms, no needs, a person spoke.
//   5. Low completion confidence never closes a check: green becomes unverified.
// A tier can only move up from what the agent said, never down.

import type { CallRecipient } from "@call-e/calle";
import type { Classification, Outcome, TriageResult } from "./types.js";

const RED_SYMPTOMS = new Set(["confusion", "faint", "hot_dry_skin", "breathing_difficulty", "chest_pain"]);

export interface ClassifyInput {
  recipient: Pick<CallRecipient, "status" | "structuredResult" | "attempts">;
  confidenceLabel: string | null;
}

export function isTriageResult(value: unknown): value is TriageResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v["answered_by"] === "string" &&
    typeof v["is_cool"] === "string" &&
    typeof v["hydrated"] === "string" &&
    Array.isArray(v["symptoms"]) &&
    Array.isArray(v["needs"]) &&
    typeof v["tier"] === "string"
  );
}

function rank(outcome: Outcome): number {
  return { green: 0, unverified: 1, yellow: 2, unreachable: 2, red: 3 }[outcome];
}

export function classify(input: ClassifyInput): Classification {
  const { recipient, confidenceLabel } = input;
  const reasons: string[] = [];
  const completedAttempt = recipient.attempts.some((a) => a.status === "completed");

  if (recipient.status === "failed" || recipient.status === "skipped" || !completedAttempt) {
    const codes = recipient.attempts.map((a) => a.failureCode).filter((c): c is string => c !== null);
    reasons.push(codes.length > 0 ? `no completed attempt (${codes.join(", ")})` : "no completed attempt");
    return { outcome: "unreachable", reasons, agentTier: null };
  }

  const result = recipient.structuredResult;
  if (!isTriageResult(result)) {
    reasons.push("call completed but no valid structured result was returned");
    return { outcome: "unverified", reasons, agentTier: null };
  }

  const agentTier = result.tier === "green" || result.tier === "yellow" || result.tier === "red" ? result.tier : null;

  if (result.answered_by === "voicemail" || result.answered_by === "ivr") {
    reasons.push(`answered by ${result.answered_by}`);
    return { outcome: "unreachable", reasons, agentTier };
  }
  if (result.answered_by === "unknown") {
    reasons.push("nobody clearly identifiable answered");
    return { outcome: "unverified", reasons, agentTier };
  }

  let outcome: Outcome = agentTier ?? "unverified";
  if (agentTier === null) {
    reasons.push("agent tier missing");
  }

  const redSymptoms = result.symptoms.filter((s) => RED_SYMPTOMS.has(s));
  if (result.confusion_suspected === true) {
    reasons.push("confusion suspected");
    outcome = "red";
  }
  if (redSymptoms.length > 0) {
    reasons.push(`red-flag symptoms: ${redSymptoms.join(", ")}`);
    outcome = "red";
  }
  if (result.needs.includes("someone_to_visit") && rank(outcome) < rank("red")) {
    reasons.push("asked for someone to visit");
    outcome = rank(outcome) < rank("yellow") ? "yellow" : outcome;
  }

  if (outcome !== "red") {
    const softSymptoms = result.symptoms.filter((s) => s !== "none");
    const realNeeds = result.needs.filter((n) => n !== "none");
    if (result.is_cool === "no") {
      reasons.push("not in a cool place");
      outcome = raiseTo(outcome, "yellow");
    }
    if (result.hydrated === "no") {
      reasons.push("not drinking water");
      outcome = raiseTo(outcome, "yellow");
    }
    if (softSymptoms.length > 0) {
      reasons.push(`symptoms: ${softSymptoms.join(", ")}`);
      outcome = raiseTo(outcome, "yellow");
    }
    if (realNeeds.length > 0) {
      reasons.push(`needs: ${realNeeds.join(", ")}`);
      outcome = raiseTo(outcome, "yellow");
    }
    if (outcome === "green") {
      if (result.is_cool !== "yes" || result.hydrated !== "yes") {
        reasons.push("green requires cool=yes and hydrated=yes; a signal was unknown");
        outcome = "unverified";
      }
    }
    if (outcome === "green" && result.answered_by === "other_person") {
      reasons.push("reported by a caregiver, not the person");
    }
  }

  if (outcome === "green" && confidenceLabel !== null && confidenceLabel.toLowerCase() === "low") {
    reasons.push("CALL-E completion confidence is low; green not accepted");
    outcome = "unverified";
  }

  if (reasons.length === 0) {
    reasons.push("cool, hydrated, no symptoms, no needs");
  }
  return { outcome, reasons, agentTier };
}

function raiseTo(current: Outcome, floor: Outcome): Outcome {
  return rank(current) < rank(floor) ? floor : current;
}
