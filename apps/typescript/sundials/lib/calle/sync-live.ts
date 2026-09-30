import type { Call } from "@call-e/calle";
import type { CallStatus, LeadDossier, SundialCallRecord, TranscriptEntry } from "../types.ts";
import { isGenericSalesAction, MISSED_PICKUP_ACTION, opportunityFromCall } from "../intent/opportunity.ts";
import { insightText } from "../intent/phrases.ts";
import { answeredByFromRecipient, asText, mergeCalleStructuredResult } from "./result-schema.ts";

type TranscriptTurn = {
  speaker: string;
  text: string;
  offset_seconds?: number | null;
  offsetSeconds?: number | null;
};

export function isInFlightStatus(status: CallStatus): boolean {
  return status === "queued" || status === "dialing" || status === "in_progress";
}

export function isTerminalCallStatus(status: CallStatus): boolean {
  return status === "completed" || status === "failed" || status === "no_answer";
}

export type CalleStatusExtras = {
  failureCode?: string | null;
  failureMessage?: string | null;
  attemptFailure?: string | null;
  hadUserSpeech?: boolean;
  answeredBy?: string;
};

function failureBlob(status: string, extras?: CalleStatusExtras): string {
  return `${status} ${extras?.failureCode || ""} ${extras?.failureMessage || ""} ${extras?.attemptFailure || ""}`.toLowerCase();
}

export function isNoAnswerOutcome(status: string, extras?: CalleStatusExtras): boolean {
  if (extras?.hadUserSpeech) return false;
  if (extras?.answeredBy === "voicemail" || extras?.answeredBy === "ivr") return true;
  const blob = failureBlob(status, extras);
  if (/insufficient|invalid_phone|invalid_recipient|unsupported|call_not_ready|\bbalance\b|\bauth/.test(blob)) {
    return false;
  }
  if (
    /no[_\s-]?answer|unanswered|did not answer|didn't answer|no pickup|not answered|voicemail|user_busy|\bbusy\b|sip.?480|no_response|no.?reply/.test(
      blob
    )
  ) {
    return true;
  }
  if (status === "canceled" && extras?.hadUserSpeech !== true) return true;
  if ((status === "failed" || status === "no_answer") && extras?.hadUserSpeech === false) return true;
  return status === "no_answer" || status === "unanswered";
}

export function mapCalleStatus(status: string, extras?: CalleStatusExtras): CallStatus {
  if (status === "queued") return "queued";
  if (status === "in_progress") return "in_progress";
  if (status === "completed") {
    if (isNoAnswerOutcome(status, extras)) return "no_answer";
    return "completed";
  }
  if (isNoAnswerOutcome(status, extras)) return "no_answer";
  if (status === "failed" || status === "canceled") return "failed";
  return "in_progress";
}

function mapSpeaker(speaker: string): TranscriptEntry["speaker"] {
  if (speaker === "bot") return "agent";
  if (speaker === "user") return "user";
  return "system";
}

function turnText(turn: TranscriptTurn): string {
  return turn.text;
}

function turnOffset(turn: TranscriptTurn): string | undefined {
  const value = turn.offsetSeconds ?? turn.offset_seconds;
  return value != null ? String(value) : undefined;
}

function allTurns(remote: Call): TranscriptTurn[] {
  const attempts = remote.recipients?.flatMap((recipient) => recipient.attempts ?? []) ?? [];
  return attempts.flatMap((attempt) => (attempt.transcriptTurns ?? []) as TranscriptTurn[]);
}

function lastAttempt(remote: Call) {
  const attempts = remote.recipients?.flatMap((recipient) => recipient.attempts ?? []) ?? [];
  return attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
}

function lastRecipient(remote: Call) {
  const list = remote.recipients ?? [];
  return list.length > 0 ? list[list.length - 1] : undefined;
}

export function applyCalleSnapshot(local: SundialCallRecord, remote: Call): SundialCallRecord {
  const next: SundialCallRecord = { ...local };
  const attempt = lastAttempt(remote);
  const recipient = lastRecipient(remote);
  const turns = allTurns(remote);
  const hadUserSpeech = turns.some(
    (turn) => mapSpeaker(turn.speaker) === "user" && turnText(turn).trim().length > 0
  );
  const answeredBy = answeredByFromRecipient(recipient?.structuredResult);
  const taskResult = remote.structuredResult;

  next.status = mapCalleStatus(remote.status, {
    failureCode: remote.failureCode,
    failureMessage: remote.failureMessage,
    attemptFailure: attempt?.failureMessage,
    hadUserSpeech,
    answeredBy
  });
  next.calleCallId = remote.id;

  if (remote.completedAt) next.endedAt = remote.completedAt;

  if (attempt?.startedAt) {
    next.dialedAt = attempt.startedAt;
    next.connectedAt = next.status === "no_answer" ? undefined : attempt.startedAt;
  }
  if (attempt?.startedAt && attempt.completedAt) {
    next.durationSec = Math.max(
      0,
      Math.round((Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt)) / 1000)
    );
  }
  if (next.dialedAt) {
    const speed = (Date.parse(next.dialedAt) - Date.parse(next.requestedAt)) / 1000;
    if (Number.isFinite(speed) && speed >= 0) {
      next.speedToDialSec = parseFloat(speed.toFixed(1));
    }
  }

  if (turns.length > 0) {
    next.transcript = turns.map((turn) => ({
      speaker: mapSpeaker(turn.speaker),
      text: turnText(turn),
      timestamp: turnOffset(turn)
    }));
  } else if (remote.summary && isTerminalCallStatus(next.status)) {
    next.transcript = [{ speaker: "system", text: remote.summary }];
  }
  if (next.transcript && next.transcript.length > 0) {
    next.fullTranscript = next.transcript
      .map((entry) => `[${entry.speaker.toUpperCase()}]: ${entry.text}`)
      .join("\n\n");
  }

  if (next.status === "failed") {
    next.errorReason =
      remote.failureMessage || remote.failureCode || attempt?.failureMessage || next.errorReason;
  }

  const structuredPain = insightText(asText(taskResult?.primary_pain));
  const canBuildDossier =
    (next.status === "completed" || next.status === "failed") && (taskResult || remote.summary);
  if (canBuildDossier && (!next.leadDossier || taskResult)) {
    const dossier: LeadDossier = {
      id: next.leadDossier?.id || `lead_${local.id}`,
      callId: local.id,
      warmthScore: remote.taskCompleted ? 8.5 : 5,
      intentTier: remote.taskCompleted ? "hot" : "nurture",
      triggerPain: structuredPain || insightText(remote.summary ?? undefined) || next.leadDossier?.triggerPain || "",
      scopeRequirement: asText(taskResult?.use_case) || insightText(next.leadDossier?.scopeRequirement) || "",
      urgencyTimeline: asText(taskResult?.timeline) || insightText(next.leadDossier?.urgencyTimeline) || "",
      estimatedBudget: insightText(next.leadDossier?.estimatedBudget) || "",
      decisionAuthority:
        asText(taskResult?.decision_role) || insightText(next.leadDossier?.decisionAuthority) || "",
      nextStep:
        next.leadDossier?.nextStep ||
        (remote.taskCompleted ? "Review transcript and send written scope" : "Follow up from transcript"),
      crmSynced: next.leadDossier?.crmSynced || false,
      createdAt: next.leadDossier?.createdAt || new Date().toISOString()
    };
    next.leadDossier = dossier;
  }

  if (isTerminalCallStatus(next.status)) {
    const prior = local.opportunityProfile;
    const heuristics = opportunityFromCall({ ...next, opportunityProfile: undefined }, next.intentSnapshot);
    const merged = mergeCalleStructuredResult(
      heuristics,
      taskResult,
      next.status === "no_answer"
    );
    next.opportunityProfile = {
      ...merged,
      callSummary: merged.callSummary || prior?.callSummary,
      leadWants: merged.leadWants || prior?.leadWants,
      nextActions: merged.nextActions || prior?.nextActions,
      painCategory: merged.painCategory || prior?.painCategory,
      useCase: merged.useCase || prior?.useCase,
      timeline: merged.timeline || prior?.timeline,
      primaryPain: prior?.painCategory || merged.primaryPain || prior?.primaryPain,
      companySize: merged.companySize || prior?.companySize,
      alternatives: merged.alternatives || prior?.alternatives,
      recommendedAction:
        merged.recommendedAction?.value === MISSED_PICKUP_ACTION
          ? merged.recommendedAction
          : prior?.recommendedAction &&
              (isGenericSalesAction(merged.recommendedAction?.value) || !merged.recommendedAction)
            ? prior.recommendedAction
            : merged.recommendedAction
    };
  }

  return next;
}
