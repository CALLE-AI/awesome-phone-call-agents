import { z } from "zod";
import type { CallStructuredResult } from "../calle/types";

export const extractedOutcomeSchema = z.object({
  disposition: z.enum([
    "completed",
    "no_answer",
    "busy",
    "voicemail",
    "failed",
    "escalated",
    "needs_review",
  ]),
  appointmentStatus: z.enum(["confirmed", "needs_reschedule", "unknown", "not_applicable"]),
  preferredCallbackTime: z.enum(["morning", "afternoon", "evening", "none", "unknown"]),
  needsHumanFollowUp: z.boolean(),
  riskFlags: z.array(z.string()),
  extractedCommitments: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)),
  provenance: z.object({
    provider: z.string(),
    modelVersion: z.string(),
    promptVersion: z.string(),
    sourceEventId: z.string(),
  }),
});

export type ExtractedOutcome = z.infer<typeof extractedOutcomeSchema>;

export type ConfidenceGate = "auto_accept" | "review_required" | "unusable";

export function gateConfidence(confidence: number): ConfidenceGate {
  if (confidence >= 0.8) return "auto_accept";
  if (confidence >= 0.45) return "review_required";
  return "unusable";
}

function mapCallbackWindow(
  window: CallStructuredResult["preferredCallbackWindow"] | undefined,
): ExtractedOutcome["preferredCallbackTime"] {
  if (!window || window === "unknown") return "unknown";
  if (window === "none") return "none";
  if (window === "morning" || window === "afternoon" || window === "evening") return window;
  return "unknown";
}

/** Deterministic extractor from normalized CALL-E structured result (no transcript storage). */
export function extractOutcomeFromStructuredResult(opts: {
  result: CallStructuredResult | null;
  status: string;
  sourceEventId: string;
  promptVersion?: string;
}): ExtractedOutcome {
  const result = opts.result;
  const confidence = result?.completionConfidence ?? (result ? 0.75 : 0.2);

  let disposition: ExtractedOutcome["disposition"] = "needs_review";
  if (!result) disposition = opts.status.includes("fail") ? "failed" : "needs_review";
  else if (result.safetyEscalation === "urgent_in_person_care") disposition = "escalated";
  else if (!result.reached) {
    disposition = result.availability === "busy" ? "busy" : "no_answer";
  } else if (confidence < 0.45) disposition = "needs_review";
  else disposition = "completed";

  const appointmentStatus: ExtractedOutcome["appointmentStatus"] =
    result?.appointmentConfirmed === true
      ? "confirmed"
      : result?.appointmentConfirmed === false
        ? "needs_reschedule"
        : result
          ? "unknown"
          : "not_applicable";

  return extractedOutcomeSchema.parse({
    disposition,
    appointmentStatus,
    preferredCallbackTime: mapCallbackWindow(result?.preferredCallbackWindow),
    needsHumanFollowUp: result?.needsHumanFollowUp ?? true,
    riskFlags:
      result?.safetyEscalation && result.safetyEscalation !== "none" ? [result.safetyEscalation] : [],
    extractedCommitments:
      result?.nextAction && result.nextAction !== "none" ? [result.nextAction] : [],
    confidence,
    fieldConfidence: {
      disposition: confidence,
      appointmentStatus: result?.appointmentConfirmed == null ? 0.4 : 0.85,
      preferredCallbackTime: result?.preferredCallbackWindow === "unknown" ? 0.35 : 0.8,
      needsHumanFollowUp: 0.8,
    },
    provenance: {
      provider: "calle-structured",
      modelVersion: "none",
      promptVersion: opts.promptVersion ?? "v3.1.0",
      sourceEventId: opts.sourceEventId,
    },
  });
}
