import type { ApprovedBookingContract } from "../domain/booking-contract.js";
import {
  CalleStructuredResultSchema,
  normalizeCalleStructuredResult,
  type VerifiedBookingOutcome,
} from "../domain/call-result.js";
import type { ProviderCallResult } from "../providers/calle/types.js";

const contradictionPattern =
  /\b(not confirmed|wasn(?:'|’)t confirmed|no confirmation|not booked|no reservation|unavailable|not available|no availability|could not confirm|couldn(?:'|’)t confirm|unable to confirm|didn(?:'|’)t confirm|declined)\b/i;
const confirmationPattern =
  /\b(reservation (?:is |was |has been )?confirmed|booking (?:is |was |has been )?confirmed|booked|all set)\b/i;

export function verifyBookingOutcome(
  contract: ApprovedBookingContract,
  raw: ProviderCallResult,
): VerifiedBookingOutcome {
  const evidence = [...raw.evidence];
  const corpus = [...raw.evidence, ...raw.transcript]
    .join("\n")
    .trim();
  const parsed = CalleStructuredResultSchema.safeParse(
    normalizeCalleStructuredResult(raw.structuredResult),
  );
  const confidence = raw.completionConfidence?.score ?? 0;

  if (raw.status !== "completed") {
    return uncertain(raw, evidence, raw.failureMessage ?? `Provider status: ${raw.status}`);
  }

  if (!parsed.success) {
    return uncertain(raw, evidence, "CALL-E did not return the required result schema.");
  }

  if (evidence.length === 0 || confidence < 0.6) {
    return uncertain(
      raw,
      evidence,
      "The outcome did not pass the confidence and evidence checks.",
    );
  }

  const result = parsed.data;

  if (result.outcome === "confirmed") {
    const exactContractMatch =
      result.confirmedDate === contract.reservation.date &&
      result.confirmedTime === contract.reservation.time &&
      result.confirmedPartySize === contract.reservation.partySize;
    const evidenceSupportsConfirmation =
      confirmationPattern.test(corpus) && !contradictionPattern.test(corpus);

    if (
      raw.taskCompleted !== true ||
      confidence < 0.6 ||
      !exactContractMatch ||
      !evidenceSupportsConfirmation ||
      evidence.length === 0
    ) {
      return uncertain(
        raw,
        evidence,
        "Confirmation did not pass contract, confidence, and evidence checks.",
      );
    }

    return {
      outcome: "confirmed",
      providerCallId: raw.providerCallId,
      confidence,
      summary: raw.summary ?? "Reservation confirmed.",
      evidence,
      needsHumanReview: false,
      confirmationCode: result.confirmationCode,
      alternativeDate: null,
      alternativeTime: null,
    };
  }

  if (result.outcome === "unavailable" && /\bunavailable|no availability\b/i.test(corpus)) {
    return resolvedNonConfirmation(raw, evidence, "unavailable", result.notes);
  }

  if (
    result.outcome === "alternative_offered" &&
    result.alternativeDate &&
    result.alternativeTime &&
    /\balternative|instead|offer\b/i.test(corpus)
  ) {
    return {
      ...resolvedNonConfirmation(raw, evidence, "alternative_offered", result.notes),
      alternativeDate: result.alternativeDate,
      alternativeTime: result.alternativeTime,
    };
  }

  if (
    result.outcome === "unreached" &&
    /\bvoicemail|no answer|not reached|failed to reach\b/i.test(corpus)
  ) {
    return resolvedNonConfirmation(raw, evidence, "unreached", result.notes);
  }

  return uncertain(raw, evidence, result.notes || "Outcome could not be verified.");
}

function resolvedNonConfirmation(
  raw: ProviderCallResult,
  evidence: readonly string[],
  outcome: "unavailable" | "alternative_offered" | "unreached",
  fallbackSummary: string,
): VerifiedBookingOutcome {
  return {
    outcome,
    providerCallId: raw.providerCallId,
    confidence: raw.completionConfidence?.score ?? 0,
    summary: raw.summary ?? fallbackSummary,
    evidence,
    needsHumanReview: true,
    confirmationCode: null,
    alternativeDate: null,
    alternativeTime: null,
  };
}

function uncertain(
  raw: ProviderCallResult,
  evidence: readonly string[],
  summary: string,
): VerifiedBookingOutcome {
  return {
    outcome: "uncertain",
    providerCallId: raw.providerCallId || null,
    confidence: raw.completionConfidence?.score ?? 0,
    summary,
    evidence,
    needsHumanReview: true,
    confirmationCode: null,
    alternativeDate: null,
    alternativeTime: null,
  };
}
