import { describe, expect, it } from "vitest";

import { normalizeProviderSnapshot } from "@/application/result-normalizer";
import type { ProviderCallSnapshot } from "@/providers/types";

const validResolvedResult = {
  contactVerification: "authorized_role",
  observedOperatingStatus: "operating_as_expected",
  unresolvedIssue: {
    value: "no",
    confidence: "high",
    evidenceRefs: [],
  },
  returnVisitRequested: {
    value: "no",
    confidence: "high",
    evidenceRefs: [],
  },
  preferredWindows: [],
  administrativeResults: {},
  outOfScopeTopics: [],
  escalationReasons: [],
  summary: "The authorized contact confirmed normal operation.",
  evidenceRefs: [],
};

const refusedResult = {
  ...validResolvedResult,
  contactVerification: "refused",
  observedOperatingStatus: "refused",
  unresolvedIssue: {
    value: "refused",
    confidence: "high",
    evidenceRefs: ["recipient-refused"],
  },
  returnVisitRequested: {
    value: "refused",
    confidence: "high",
    evidenceRefs: ["recipient-refused"],
  },
  escalationReasons: ["recipient_refused"],
  summary: "The recipient refused the automated conversation.",
};

function snapshot(overrides: Partial<ProviderCallSnapshot>): ProviderCallSnapshot {
  return {
    providerCallId: "call_1",
    taskStatus: "completed",
    attemptOutcome: "answered",
    structuredResult: validResolvedResult,
    ...overrides,
  };
}

describe("provider snapshot normalization", () => {
  it("never routes a failed or canceled provider task to closeout review", () => {
    const failed = normalizeProviderSnapshot(
      snapshot({
        taskStatus: "failed",
        attemptOutcome: "unknown",
        structuredResult: validResolvedResult,
      }),
    );

    const canceled = normalizeProviderSnapshot(
      snapshot({
        taskStatus: "canceled",
        attemptOutcome: "unknown",
        structuredResult: validResolvedResult,
      }),
    );

    expect(failed.route).toBe("failed");
    expect(failed.providerTaskStatus).toBe("failed");
    expect(canceled.route).toBe("failed");
    expect(canceled.providerTaskStatus).toBe("canceled");
  });

  it("treats a plain refusal as a do-not-call request", () => {
    const normalized = normalizeProviderSnapshot(
      snapshot({
        attemptOutcome: "refused",
        structuredResult: refusedResult,
      }),
    );

    expect(normalized.doNotCallRequested).toBe(true);
    expect(normalized.route).toBe("human_follow_up");
  });

  it("does not treat an answered contact as do-not-call", () => {
    const normalized = normalizeProviderSnapshot(
      snapshot({
        attemptOutcome: "answered",
        structuredResult: validResolvedResult,
      }),
    );

    expect(normalized.doNotCallRequested).toBe(false);
    expect(normalized.route).toBe("ready_for_closeout_review");
  });

  it("preserves an explicit do-not-call escalation reason", () => {
    const normalized = normalizeProviderSnapshot(
      snapshot({
        structuredResult: {
          ...validResolvedResult,
          escalationReasons: ["do_not_call_requested"],
        },
      }),
    );

    expect(normalized.doNotCallRequested).toBe(true);
  });

  it("keeps a missing-result snapshot unreachable or failed without a closeout route", () => {
    const unreachable = normalizeProviderSnapshot(
      snapshot({
        attemptOutcome: "no_answer",
        structuredResult: null,
      }),
    );
    const failed = normalizeProviderSnapshot(
      snapshot({
        taskStatus: "failed",
        attemptOutcome: "unknown",
        structuredResult: null,
      }),
    );

    expect(unreachable.route).toBe("unreachable");
    expect(failed.route).toBe("failed");
  });

  it("keeps a non-terminal status from producing a terminal closeout route", () => {
    const inProgress = normalizeProviderSnapshot(
      snapshot({
        taskStatus: "in_progress",
        attemptOutcome: "not_determined",
        structuredResult: null,
      }),
    );

    expect(inProgress.route).toBe("human_follow_up");
    expect(inProgress.providerTaskStatus).toBe("in_progress");
  });
});
