import type { ProviderCallSnapshot } from "@/providers/types";

export const fakeScenarioIdValues = [
  "resolved_clear",
  "issue_return_requested",
  "ambiguous_after_clarification",
  "wrong_person",
  "refused",
  "do_not_call",
  "no_answer",
  "voicemail",
  "technical_advice_requested",
  "commercial_commitment_requested",
  "malformed_provider_result",
  "creation_timeout_unknown",
  "duplicate_submit",
] as const;

export type FakeScenarioId = (typeof fakeScenarioIdValues)[number];

type FakeScenarioSnapshot = Omit<ProviderCallSnapshot, "providerCallId">;

const notAskedAnswer = {
  value: "not_asked",
  confidence: "unavailable",
  evidenceRefs: [],
} as const;

const unknownAnswer = {
  value: "unknown",
  confidence: "low",
  evidenceRefs: ["fake-provider:ambiguous-answer"],
} as const;

const resolvedClearResult = {
  contactVerification: "authorized_role",
  observedOperatingStatus: "operating_as_expected",
  unresolvedIssue: {
    value: "no",
    confidence: "high",
    evidenceRefs: ["fake-provider:unresolved-issue"],
    note: "The fictional contact reported no remaining issue.",
  },
  returnVisitRequested: {
    value: "no",
    confidence: "high",
    evidenceRefs: ["fake-provider:return-visit-request"],
  },
  preferredWindows: [],
  administrativeResults: {},
  outOfScopeTopics: [],
  escalationReasons: [],
  summary:
    "The fictional authorized site role reported normal operation and no unresolved issue or return-visit request.",
  evidenceRefs: [
    "fake-provider:contact-verification",
    "fake-provider:operating-status",
    "fake-provider:unresolved-issue",
    "fake-provider:return-visit-request",
  ],
};

const fakeScenarioSnapshots: Record<FakeScenarioId, FakeScenarioSnapshot> = {
  resolved_clear: {
    taskStatus: "completed",
    attemptOutcome: "answered",
    structuredResult: resolvedClearResult,
  },
  issue_return_requested: {
    taskStatus: "completed",
    attemptOutcome: "answered",
    structuredResult: {
      contactVerification: "intended_contact",
      observedOperatingStatus: "not_operating_as_expected",
      unresolvedIssue: {
        value: "yes",
        confidence: "high",
        evidenceRefs: ["fake-provider:unresolved-issue"],
        note: "The fictional contact reported that the serviced area was still warm.",
      },
      returnVisitRequested: {
        value: "yes",
        confidence: "high",
        evidenceRefs: ["fake-provider:return-visit-request"],
      },
      preferredWindows: [
        {
          startLocal: "2026-07-30T09:00:00",
          endLocal: "2026-07-30T12:00:00",
          timezone: "America/Chicago",
          status: "reported_preference_not_confirmed",
        },
      ],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["return_visit_requested"],
      summary:
        "The fictional contact reported an unresolved issue and asked the contractor to review a return visit.",
      evidenceRefs: [
        "fake-provider:contact-verification",
        "fake-provider:operating-status",
        "fake-provider:unresolved-issue",
        "fake-provider:return-visit-request",
      ],
    },
  },
  ambiguous_after_clarification: {
    taskStatus: "completed",
    attemptOutcome: "partial_answer",
    structuredResult: {
      contactVerification: "authorized_role",
      observedOperatingStatus: "unknown",
      unresolvedIssue: unknownAnswer,
      returnVisitRequested: unknownAnswer,
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["ambiguous_after_one_clarification"],
      summary:
        "The fictional contact's answers remained unclear after one bounded clarification.",
      evidenceRefs: ["fake-provider:ambiguous-answer"],
    },
  },
  wrong_person: {
    taskStatus: "completed",
    attemptOutcome: "wrong_person",
    structuredResult: {
      contactVerification: "wrong_person",
      observedOperatingStatus: "not_asked",
      unresolvedIssue: notAskedAnswer,
      returnVisitRequested: notAskedAnswer,
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["wrong_person"],
      summary:
        "The recipient was not the intended or authorized contact; no case details were discussed.",
      evidenceRefs: ["fake-provider:contact-verification"],
    },
  },
  refused: {
    taskStatus: "completed",
    attemptOutcome: "refused",
    structuredResult: {
      contactVerification: "refused",
      observedOperatingStatus: "refused",
      unresolvedIssue: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["fake-provider:recipient-refused"],
      },
      returnVisitRequested: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["fake-provider:recipient-refused"],
      },
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["recipient_refused"],
      summary: "The fictional recipient refused the automated conversation.",
      evidenceRefs: ["fake-provider:recipient-refused"],
    },
  },
  do_not_call: {
    taskStatus: "completed",
    attemptOutcome: "refused",
    structuredResult: {
      contactVerification: "refused",
      observedOperatingStatus: "refused",
      unresolvedIssue: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["fake-provider:do-not-call"],
      },
      returnVisitRequested: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["fake-provider:do-not-call"],
      },
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["do_not_call_requested"],
      summary:
        "The fictional recipient requested no further automated calls.",
      evidenceRefs: ["fake-provider:do-not-call"],
    },
  },
  no_answer: {
    taskStatus: "completed",
    attemptOutcome: "no_answer",
    structuredResult: null,
  },
  voicemail: {
    taskStatus: "completed",
    attemptOutcome: "voicemail",
    structuredResult: null,
  },
  technical_advice_requested: {
    taskStatus: "completed",
    attemptOutcome: "partial_answer",
    structuredResult: {
      contactVerification: "authorized_role",
      observedOperatingStatus: "unknown",
      unresolvedIssue: unknownAnswer,
      returnVisitRequested: notAskedAnswer,
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: ["technical_advice"],
      escalationReasons: ["out_of_scope_technical_request"],
      summary:
        "The fictional contact requested technical advice; the agent declined and ended within scope.",
      evidenceRefs: ["fake-provider:out-of-scope-topic"],
    },
  },
  commercial_commitment_requested: {
    taskStatus: "completed",
    attemptOutcome: "partial_answer",
    structuredResult: {
      contactVerification: "authorized_role",
      observedOperatingStatus: "unknown",
      unresolvedIssue: unknownAnswer,
      returnVisitRequested: notAskedAnswer,
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: ["commercial_commitment"],
      escalationReasons: ["out_of_scope_commercial_request"],
      summary:
        "The fictional contact requested a price or timing commitment; the agent made no commitment.",
      evidenceRefs: ["fake-provider:out-of-scope-topic"],
    },
  },
  malformed_provider_result: {
    taskStatus: "completed",
    attemptOutcome: "unknown",
    structuredResult: {
      unexpected: "This object intentionally fails the result schema.",
    },
  },
  creation_timeout_unknown: {
    taskStatus: "unknown",
    attemptOutcome: "unknown",
    structuredResult: null,
  },
  duplicate_submit: {
    taskStatus: "completed",
    attemptOutcome: "answered",
    structuredResult: resolvedClearResult,
  },
};

export function getFakeScenarioSnapshot(scenarioId: FakeScenarioId) {
  return fakeScenarioSnapshots[scenarioId];
}
