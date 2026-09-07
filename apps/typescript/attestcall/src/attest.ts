/**
 * Core attestation logic: builds the CALL-E task text (the "script"),
 * derives an idempotency key, classifies the outcome fail-closed, and
 * assembles the audit record payload.
 */
import { createHash } from "node:crypto";
import type { Call } from "@call-e/calle";
import type {
  AttestationAnswers,
  AttestationRequest,
  AuditRecord,
  Disposition,
} from "./types.js";
import { maskPhone, redactPhonesInText } from "./util.js";

const FRAMEWORK_LABEL: Record<string, string> = {
  "PCI-DSS": "PCI DSS",
  "SOC2-TYPE2": "SOC 2 Type II",
  "ISO-27001": "ISO/IEC 27001",
  HIPAA: "HIPAA",
  GDPR: "GDPR",
};

/** Minimum confidence below which we never auto-accept an attestation. */
export const MIN_CONFIDENCE = 0.75;

/**
 * Build the goal-driven task text handed to CALL-E. It discloses the AI
 * caller, states purpose, asks for consent to record, and enumerates exactly
 * what to capture. It explicitly instructs CALL-E not to fabricate.
 */
export function buildAttestationTask(req: AttestationRequest): string {
  const fw = FRAMEWORK_LABEL[req.framework] ?? req.framework;
  const ref = req.referenceId ? ` Our reference on file is ${req.referenceId}.` : "";
  return [
    `Call ${req.vendorName} at ${req.vendorPhone} on behalf of ${req.requestedBy}.`,
    `Clearly disclose at the start that you are an automated assistant calling to record a point-in-time compliance attestation, and that the call may be recorded.`,
    `Purpose: obtain a current attestation of the organization's ${fw} compliance status.${ref}`,
    `First, ask whether the person consents to this attestation being recorded for compliance purposes. If they decline consent, thank them and end the call.`,
    `If they consent, ask them to confirm: (1) whether the organization is currently compliant with ${fw}; (2) the certificate or attestation expiry date; (3) the name of the auditor or assessor firm; (4) their own name and role; and (5) any scope limitations.`,
    `Do not pressure, negotiate, or offer opinions. Do not fabricate any detail. If the person cannot answer a question or is unsure, record it as unknown rather than guessing.`,
    `Be brief and professional. End the call politely once the questions are answered or the person declines.`,
  ].join(" ");
}

/**
 * Derive a stable idempotency key from the AUTHORIZATION (who/what/when-scope),
 * not the attempt. Two identical authorized requests collapse to one call.
 */
export function deriveIdempotencyKey(req: AttestationRequest, scopeDay: string): string {
  const material = [req.vendorPhone, req.framework, req.referenceId ?? "", scopeDay].join("|");
  return "attest_" + createHash("sha256").update(material).digest("hex").slice(0, 24);
}

/** Today's date (UTC) as YYYY-MM-DD, used for idempotency scoping. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Classify the CALL-E result into a fail-closed disposition.
 *
 * Rules (any failure routes to a human, never a silent success):
 * - call not completed -> call_failed
 * - low/absent completion confidence -> needs_human
 * - no consent to record -> needs_human
 * - is_compliant unknown -> needs_human
 * - is_compliant no -> not_attested
 * - is_compliant yes AND consent yes AND confidence ok AND evidence present -> attested
 */
export function classify(call: Call, answers: Partial<AttestationAnswers>): Disposition {
  if (call.status !== "completed" || call.taskCompleted !== true) {
    return "call_failed";
  }
  const conf = call.completionConfidence?.score ?? 0;
  if (conf < MIN_CONFIDENCE) return "needs_human";

  if (answers.consent_to_record !== "yes") return "needs_human";

  const compliant = answers.is_compliant;
  if (compliant === "no") return "not_attested";
  if (compliant !== "yes") return "needs_human";

  // Attested only if there is at least one piece of grounding evidence.
  if (!call.evidence || call.evidence.length === 0) return "needs_human";

  return "attested";
}

/** Extract the structured answers from a Call (recipient-level or top-level). */
export function extractAnswers(call: Call): Partial<AttestationAnswers> {
  const top = (call.structuredResult ?? {}) as Partial<AttestationAnswers>;
  const recip = (call.recipients?.[0]?.structuredResult ?? {}) as Partial<AttestationAnswers>;
  return { ...recip, ...top };
}

/** Build the audit-record payload (pre-hash) from a completed Call. */
export function toAuditPayload(
  req: AttestationRequest,
  call: Call,
  mode: "live" | "demo",
): Omit<AuditRecord, "index" | "sealedAt" | "prevHash" | "hash"> {
  const answers = extractAnswers(call);
  const disposition = classify(call, answers);
  const { vendorPhone, ...rest } = req;
  return {
    request: { ...rest, vendorPhoneMasked: maskPhone(vendorPhone) },
    disposition,
    answers,
    completionConfidence: call.completionConfidence ?? null,
    evidence: (call.evidence ?? []).map(redactPhonesInText),
    callId: call.id,
    callStatus: call.status,
    mode,
  };
}
