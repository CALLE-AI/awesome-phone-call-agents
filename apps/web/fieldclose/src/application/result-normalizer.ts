import { z } from "zod";

import type { AnswerValue } from "@/domain/contracts";
import {
  answerConfidenceValues,
  answerValueValues,
  contactVerificationValues,
  observedOperatingStatusValues,
} from "@/domain/enums";
import type { ProviderCallSnapshot } from "@/providers/types";

const answerValueSchema = z.object({
  value: z.enum(answerValueValues),
  confidence: z.enum(answerConfidenceValues),
  evidenceRefs: z.array(z.string().max(200)).max(20),
  note: z.string().max(500).optional(),
});

const structuredResultSchema = z.object({
  contactVerification: z.enum(contactVerificationValues),
  observedOperatingStatus: z.enum(observedOperatingStatusValues),
  unresolvedIssue: answerValueSchema,
  returnVisitRequested: answerValueSchema,
  preferredWindows: z
    .array(
      z.object({
        startLocal: z.string().max(40),
        endLocal: z.string().max(40),
        timezone: z.string().max(100),
        status: z.literal("reported_preference_not_confirmed"),
      }),
    )
    .max(5),
  administrativeResults: z.record(
    z.string().max(100),
    z.union([z.string().max(500), z.boolean(), z.null()]),
  ),
  outOfScopeTopics: z.array(z.string().max(100)).max(20),
  escalationReasons: z.array(z.string().max(100)).max(20),
  summary: z.string().min(1).max(1_000),
  evidenceRefs: z.array(z.string().max(200)).max(50),
});

export type NormalizedCallResult = z.infer<typeof structuredResultSchema> & {
  providerCallId: string;
  providerTaskStatus: ProviderCallSnapshot["taskStatus"];
  route:
    | "ready_for_closeout_review"
    | "return_visit_review"
    | "human_follow_up"
    | "unreachable"
    | "failed";
  normalizerVersion: "fieldclose-v1";
  validationFailed: boolean;
  doNotCallRequested: boolean;
};

export function normalizeProviderSnapshot(
  snapshot: ProviderCallSnapshot,
): NormalizedCallResult {
  if (snapshot.structuredResult === null) {
    return normalizeMissingResult(snapshot);
  }

  const parsed = structuredResultSchema.safeParse(snapshot.structuredResult);

  if (!parsed.success) {
    return {
      providerCallId: snapshot.providerCallId,
      providerTaskStatus: snapshot.taskStatus,
      contactVerification: "unverified",
      observedOperatingStatus: "unknown",
      unresolvedIssue: unavailableAnswer(),
      returnVisitRequested: unavailableAnswer(),
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["result_validation_failed"],
      summary:
        "The provider result did not match the approved FieldClose schema and requires human review.",
      evidenceRefs: [],
      route: "human_follow_up",
      normalizerVersion: "fieldclose-v1",
      validationFailed: true,
      doNotCallRequested: false,
    };
  }

  return {
    providerCallId: snapshot.providerCallId,
    providerTaskStatus: snapshot.taskStatus,
    ...parsed.data,
    route: selectResultRoute(parsed.data),
    normalizerVersion: "fieldclose-v1",
    validationFailed: false,
    doNotCallRequested: parsed.data.escalationReasons.includes(
      "do_not_call_requested",
    ),
  };
}

function normalizeMissingResult(
  snapshot: ProviderCallSnapshot,
): NormalizedCallResult {
  const unreachable = ["no_answer", "busy", "voicemail"].includes(
    snapshot.attemptOutcome,
  );
  const providerFailed = snapshot.taskStatus === "failed";
  const route = providerFailed
    ? "failed"
    : unreachable
      ? "unreachable"
      : "human_follow_up";
  const reason = providerFailed
    ? "provider_failed"
    : unreachable
      ? `attempt_${snapshot.attemptOutcome}`
      : "provider_result_unavailable";

  return {
    providerCallId: snapshot.providerCallId,
    providerTaskStatus: snapshot.taskStatus,
    contactVerification: "not_connected",
    observedOperatingStatus: "not_asked",
    unresolvedIssue: unavailableAnswer(),
    returnVisitRequested: unavailableAnswer(),
    preferredWindows: [],
    administrativeResults: {},
    outOfScopeTopics: [],
    escalationReasons: [reason],
    summary: unreachable
      ? "No authorized closeout conversation occurred."
      : "No usable provider result was available.",
    evidenceRefs: [],
    route,
    normalizerVersion: "fieldclose-v1",
    validationFailed: false,
    doNotCallRequested: false,
  };
}

function selectResultRoute(
  result: z.infer<typeof structuredResultSchema>,
): NormalizedCallResult["route"] {
  if (
    result.contactVerification !== "intended_contact" &&
    result.contactVerification !== "authorized_role"
  ) {
    return "human_follow_up";
  }

  if (
    result.outOfScopeTopics.length > 0 ||
    result.escalationReasons.some(
      (reason) => reason !== "return_visit_requested",
    )
  ) {
    return "human_follow_up";
  }

  if (
    result.returnVisitRequested.value === "yes" ||
    result.unresolvedIssue.value === "yes" ||
    result.observedOperatingStatus === "not_operating_as_expected" ||
    result.observedOperatingStatus === "mixed_or_partial"
  ) {
    return "return_visit_review";
  }

  if (
    result.unresolvedIssue.value !== "no" ||
    result.returnVisitRequested.value !== "no" ||
    result.observedOperatingStatus !== "operating_as_expected"
  ) {
    return "human_follow_up";
  }

  return "ready_for_closeout_review";
}

function unavailableAnswer(): AnswerValue {
  return {
    value: "not_asked",
    confidence: "unavailable",
    evidenceRefs: [],
  };
}
