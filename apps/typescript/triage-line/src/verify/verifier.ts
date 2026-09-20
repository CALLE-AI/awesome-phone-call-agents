/**
 * Verification layer — the anti-hallucination trust gate.
 *
 * Never trust CALL-E's taskCompleted blindly. For each result we:
 *   - gate on completionConfidence.score (below threshold -> not trusted)
 *   - require that every field named in resultSchema.required is present
 *   - cross-check "evidence-bearing" fields (e.g. confirmation_number) actually
 *     appear somewhere in the transcript/evidence, not just in structuredResult
 *   - run policy assertions (see policy.ts)
 *
 * The output VerificationReport tells the executor what status to assign and
 * carries notes/flags the UI can surface next to the transcript.
 */

import type {
  CalleCallOutcome,
  CallNode,
  VerificationReport,
} from "../graph/types.js";
import { assertPolicy } from "./policy.js";

/** Default confidence gate. Results below this are not auto-trusted. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Fields that must be traceable to the transcript/evidence, not just asserted
 * in structuredResult. If the schema requires one of these, its value has to
 * appear in the call record or we downgrade to needs_review.
 */
const EVIDENCE_BEARING_FIELDS = new Set([
  "confirmation_number",
  "preauth_code",
  "reference_number",
  "booking_id",
]);

export interface VerifyOptions {
  confidenceThreshold?: number;
}

export function verify(
  node: CallNode,
  outcome: CalleCallOutcome,
  opts: VerifyOptions = {}
): VerificationReport {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const notes: string[] = [];
  const policyFlags: string[] = [];

  // 1. Non-completed calls (no answer, voicemail, failed) are never "done".
  if (outcome.status !== "completed" || !outcome.taskCompleted) {
    notes.push(
      `Call did not complete the task (status=${outcome.status}, taskCompleted=${outcome.taskCompleted}).`
    );
    return {
      trusted: false,
      status: outcome.status === "failed" ? "failed" : "needs_review",
      notes,
      policyFlags,
    };
  }

  const score = outcome.completionConfidence?.score ?? 0;
  const haystack = [
    ...(outcome.transcript ?? []).map((t) => t.text),
    ...(outcome.evidence ?? []),
  ]
    .join("\n")
    .toLowerCase();

  // 2. Confidence gate.
  let confidenceOk = true;
  if (score < threshold) {
    confidenceOk = false;
    notes.push(
      `Confidence ${score.toFixed(2)} is below threshold ${threshold.toFixed(
        2
      )}${outcome.completionConfidence?.reason ? ` (${outcome.completionConfidence.reason})` : ""}.`
    );
  }

  // 3. Required fields present in structuredResult.
  const result = outcome.structuredResult ?? {};
  const required = node.resultSchema.required ?? [];
  const missing = required.filter(
    (f) => result[f] === undefined || result[f] === null
  );
  if (missing.length) {
    notes.push(`Missing required field(s): ${missing.join(", ")}.`);
  }

  // 4. Evidence-bearing fields must be traceable to the transcript/evidence.
  const untraceable: string[] = [];
  for (const field of required) {
    if (!EVIDENCE_BEARING_FIELDS.has(field)) continue;
    const value = result[field];
    if (value === undefined || value === null) continue; // already in `missing`
    const needle = String(value).toLowerCase();
    if (needle && !haystack.includes(needle)) {
      untraceable.push(field);
    }
  }
  if (untraceable.length) {
    notes.push(
      `Field(s) not found in transcript/evidence (possible hallucination): ${untraceable.join(
        ", "
      )}.`
    );
  }

  // 5. Policy assertions.
  const policy = assertPolicy(outcome, node.policy);
  if (!policy.ok) {
    policyFlags.push(...policy.flags);
    notes.push(...policy.flags);
  }

  // Decide final status.
  const hardProblem = missing.length > 0 || untraceable.length > 0;
  if (policyFlags.length) {
    // Policy issues always require a human, even if data looks fine.
    return { trusted: false, status: "needs_user", notes, policyFlags };
  }
  if (!confidenceOk || hardProblem) {
    return { trusted: false, status: "needs_review", notes, policyFlags };
  }

  notes.push("Verified: confidence ok, required fields present and traceable.");
  return { trusted: true, status: "done", notes, policyFlags };
}

/** Heuristic: did this outcome look like it hit a language barrier? */
export function looksLikeLanguageBarrier(outcome: CalleCallOutcome): boolean {
  const reason = outcome.completionConfidence?.reason?.toLowerCase() ?? "";
  if (reason.includes("language") || reason.includes("spanish") || reason.includes("barrier")) {
    return true;
  }
  const text = [
    ...(outcome.transcript ?? []).map((t) => t.text),
    ...(outcome.evidence ?? []),
  ]
    .join(" ")
    .toLowerCase();
  // Common signals the callee asked for another language.
  return /no entiendo|habla espa|¿español|no english|other language/.test(text);
}
