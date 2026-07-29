/**
 * Fail-closed decision logic.
 *
 * Two rules carry the design.
 *
 * The transcript is authoritative and the extracted result is corroboration.
 * CALL-E's own `structured_result` can be null on a call that went perfectly,
 * so a gate that needed it would fail for the wrong reason and a gate that
 * trusted it alone would approve a production change on a summary. This gate
 * reads the recipient turns itself, then refuses to approve when the extracted
 * decision contradicts what it read.
 *
 * Silence is never approval. A machine answering, an empty transcript, a
 * missing code, a low completion confidence and an API failure all land on
 * `not_approved` with a reason. The only path to `approved` is a person who
 * returned the secret and said yes.
 */

import { redactSecret, secretDigest } from "./secret.js";
import { decisionFromLines, looksLikeMachine, readTranscript } from "./transcript.js";
import type {
  ApprovalRequest,
  Approver,
  AttemptEvaluation,
  CallSnapshot,
  Confidence,
  Decision,
  NotApprovedReason,
  OutcomeInputs,
  Policy,
  Verdict,
} from "./types.js";

const NO_ANSWER_HINTS = ["no_answer", "noanswer", "busy", "unreachable", "declined", "rejected_by_recipient", "not_answered"];
const MACHINE_HINTS = ["voicemail", "machine", "ivr", "answering"];

function hints(code: string | null, table: string[]): boolean {
  if (code === null) {
    return false;
  }
  const value = code.toLowerCase();
  return table.some((hint) => value.includes(hint));
}

function readDecision(value: unknown): Decision | null {
  if (value === "approve" || value === "reject" || value === "unknown") {
    return value;
  }
  return null;
}

/**
 * The single place an attempt outcome is decided. The gate calls it live and
 * the audit verifier calls it again on the recorded inputs, so a record whose
 * verdict was edited by hand fails verification even when its hash chain is
 * intact.
 */
export function attemptOutcome(
  inputs: OutcomeInputs,
  policy: Policy,
): { outcome: Verdict; reason: NotApprovedReason | null } {
  if (inputs.decision === "reject" || inputs.structured_decision === "reject") {
    return { outcome: "rejected", reason: null };
  }
  if (inputs.call_status === "failed" || inputs.call_status === "canceled") {
    if (hints(inputs.failure_code, MACHINE_HINTS)) {
      return { outcome: "not_approved", reason: "voicemail" };
    }
    if (hints(inputs.failure_code, NO_ANSWER_HINTS)) {
      return { outcome: "not_approved", reason: "no_answer" };
    }
    return { outcome: "not_approved", reason: "call_failed" };
  }
  if (inputs.call_status !== "completed") {
    // Still queued, dialing or talking when the clock ran out.
    return { outcome: "not_approved", reason: "timed_out" };
  }
  if (inputs.machine_answered) {
    return { outcome: "not_approved", reason: "voicemail" };
  }
  if (!inputs.transcript_available && !policy.allowStructuredOnly) {
    return { outcome: "not_approved", reason: "no_transcript_evidence" };
  }
  if (!inputs.reached_person) {
    return { outcome: "not_approved", reason: "not_reached" };
  }
  if (!inputs.code_match) {
    return { outcome: "not_approved", reason: "code_mismatch" };
  }
  if (inputs.decision !== "approve") {
    return { outcome: "not_approved", reason: "no_decision" };
  }
  if (inputs.structured_decision !== null && inputs.structured_decision !== "approve") {
    return { outcome: "not_approved", reason: "disagreement" };
  }
  if (inputs.confidence !== null && inputs.confidence.score < policy.minConfidence) {
    return { outcome: "not_approved", reason: "low_confidence" };
  }
  return { outcome: "approved", reason: null };
}

/** Mask a number for logs and records. Keeps the country code and last two digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return "***";
  }
  const head = phone.slice(0, 3);
  const tail = phone.slice(-2);
  return `${head}${"*".repeat(Math.max(phone.length - 5, 1))}${tail}`;
}

export function evaluateAttempt(options: {
  request: ApprovalRequest;
  approver: Approver;
  call: CallSnapshot | null;
  code: string;
  phrase: string[];
  apiErrorCode?: string | null;
}): AttemptEvaluation {
  const { request, approver, call, code, phrase } = options;
  const policy = request.policy;
  const expectedSecret = policy.binding === "code_from_request" ? code : phrase.join(" ");
  const digest = secretDigest(request.requestId, expectedSecret);
  const base = {
    approver_id: approver.id,
    phone_masked: maskPhone(approver.phone),
    secret_digest: digest,
  };

  if (call === null) {
    return {
      ...base,
      call_id: null,
      provider_call_id: null,
      outcome: "not_approved",
      reason: "api_error",
      evidence: {
        call_status: "api_error",
        failure_code: options.apiErrorCode ?? null,
        reached_person: false,
        machine_answered: false,
        transcript_available: false,
        code_match: false,
        decision: "unknown",
        structured_decision: null,
        confidence: null,
      },
      spoken_secret_digest: null,
      transcript_excerpt: [],
      started_at: null,
      completed_at: null,
    };
  }

  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;
  const turns = attempt?.transcriptTurns ?? [];
  const reading = readTranscript(turns, { binding: policy.binding, code, phrase });
  const structured = call.structuredResult ?? recipient?.structuredResult ?? null;
  const structuredDecision = structured === null ? null : readDecision(structured.decision);
  const structuredCode =
    structured !== null && typeof structured.spoken_code === "string" ? structured.spoken_code : "";

  const machineAnswered = looksLikeMachine(turns) && reading.decisionSignal === "unknown";
  const transcriptAvailable = turns.length > 0;
  const reachedPerson = reading.userTurnCount > 0 && !machineAnswered;

  let codeMatch = reading.secretSpoken;
  let spokenSecretDigest: string | null = null;
  if (codeMatch) {
    spokenSecretDigest = digest;
  } else if (policy.binding === "code_from_request" && reading.spokenDigits !== null) {
    spokenSecretDigest = secretDigest(request.requestId, reading.spokenDigits);
  }

  // Structured evidence can stand in for a transcript only when the operator
  // opted in and no transcript came back at all.
  let decision = reading.decisionSignal;
  if (!transcriptAvailable && policy.allowStructuredOnly) {
    if (policy.binding === "code_from_request" && structuredCode.length > 0) {
      const digits = structuredCode.replace(/\D/g, "");
      codeMatch = digits.includes(code);
      spokenSecretDigest = secretDigest(request.requestId, codeMatch ? code : digits);
    }
    if (structuredDecision !== null) {
      decision = structuredDecision;
    }
  }

  const confidence: Confidence | null = call.completionConfidence ?? null;
  const evidence: OutcomeInputs = {
    call_status: call.status,
    failure_code: attempt?.failureCode ?? call.failureCode ?? null,
    reached_person: reachedPerson || (!transcriptAvailable && policy.allowStructuredOnly),
    machine_answered: machineAnswered,
    transcript_available: transcriptAvailable,
    code_match: codeMatch,
    decision,
    structured_decision: structuredDecision,
    confidence,
  };
  const { outcome, reason } = attemptOutcome(evidence, policy);

  // The secret never reaches the record. What is kept is the decision language
  // plus the digests, which is what verification needs.
  const excerpt = reading.excerpt.map((line) =>
    redactSecret(line, code, policy.binding === "liveness_phrase" ? phrase : []),
  );

  return {
    ...base,
    call_id: call.id,
    provider_call_id: attempt?.providerCallId ?? null,
    outcome,
    reason,
    evidence,
    spoken_secret_digest: spokenSecretDigest,
    transcript_excerpt: excerpt,
    started_at: attempt?.startedAt ?? call.createdAt,
    completed_at: attempt?.completedAt ?? call.completedAt,
  };
}

/**
 * Fold attempt outcomes into one verdict. A rejection anywhere is final, so an
 * escalation ladder cannot walk past a person who said no. Dual control needs
 * two approvals from two different enrolled approvers.
 */
export function verdictFromAttempts(
  attempts: AttemptEvaluation[],
  policy: Policy,
): { verdict: Verdict; reason: NotApprovedReason | null; approvedBy: string[] } {
  const rejected = attempts.find((attempt) => attempt.outcome === "rejected");
  if (rejected !== undefined) {
    return { verdict: "rejected", reason: null, approvedBy: [] };
  }
  const approvedBy = [
    ...new Set(
      attempts.filter((attempt) => attempt.outcome === "approved").map((attempt) => attempt.approver_id),
    ),
  ];
  const needed = policy.mode === "dual" ? 2 : 1;
  if (approvedBy.length >= needed) {
    return { verdict: "approved", reason: null, approvedBy };
  }
  if (approvedBy.length > 0) {
    return { verdict: "not_approved", reason: "quorum_not_met", approvedBy };
  }
  const last = attempts.at(-1);
  return {
    verdict: "not_approved",
    reason: last?.reason ?? "not_reached",
    approvedBy: [],
  };
}

/** Decision re-read from the recorded excerpt, used by audit verification. */
export function decisionFromExcerpt(lines: string[]): Decision {
  return decisionFromLines(lines);
}
