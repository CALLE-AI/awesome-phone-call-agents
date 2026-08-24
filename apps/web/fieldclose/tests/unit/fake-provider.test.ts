import { describe, expect, it } from "vitest";

import { normalizeProviderSnapshot } from "@/application/result-normalizer";
import { FakeCallProvider } from "@/providers/fake/fake-call-provider";
import type { FakeScenarioId } from "@/providers/fake/scenarios";
import type { ApprovedCallBrief } from "@/providers/types";

const expectedRoutes: Record<
  Exclude<FakeScenarioId, "creation_timeout_unknown" | "duplicate_submit">,
  string
> = {
  resolved_clear: "ready_for_closeout_review",
  issue_return_requested: "return_visit_review",
  ambiguous_after_clarification: "human_follow_up",
  wrong_person: "human_follow_up",
  refused: "human_follow_up",
  do_not_call: "human_follow_up",
  no_answer: "unreachable",
  voicemail: "unreachable",
  technical_advice_requested: "human_follow_up",
  commercial_commitment_requested: "human_follow_up",
  malformed_provider_result: "human_follow_up",
};

describe("fake call provider", () => {
  it.each(Object.entries(expectedRoutes))(
    "normalizes %s to %s without a network call",
    async (scenarioId, expectedRoute) => {
      const provider = new FakeCallProvider(scenarioId as FakeScenarioId);
      const creation = await provider.createCall(createRequest());

      expect(creation.disposition).toBe("created");

      if (creation.disposition !== "created") {
        throw new Error("Expected the deterministic fake call to be created");
      }

      const snapshot = await provider.getCall(creation.providerCallId);
      const normalized = normalizeProviderSnapshot(snapshot);

      expect(normalized.route).toBe(expectedRoute);
      expect(normalized.providerCallId).toBe(creation.providerCallId);
    },
  );

  it("preserves malformed output as a bounded validation failure", async () => {
    const provider = new FakeCallProvider("malformed_provider_result");
    const creation = await provider.createCall(createRequest());

    if (creation.disposition !== "created") {
      throw new Error("Expected the deterministic fake call to be created");
    }

    const normalized = normalizeProviderSnapshot(
      await provider.getCall(creation.providerCallId),
    );

    expect(normalized).toMatchObject({
      route: "human_follow_up",
      validationFailed: true,
      escalationReasons: ["result_validation_failed"],
    });
  });

  it("returns an ambiguous creation outcome without inventing a call ID", async () => {
    const provider = new FakeCallProvider("creation_timeout_unknown");

    await expect(provider.createCall(createRequest())).resolves.toEqual({
      disposition: "ambiguous_requires_reconciliation",
      errorCode: "fake_creation_timeout",
    });
  });

  it("marks a do-not-call request for durable contact blocking", async () => {
    const provider = new FakeCallProvider("do_not_call");
    const creation = await provider.createCall(createRequest());

    if (creation.disposition !== "created") {
      throw new Error("Expected the deterministic fake call to be created");
    }

    expect(
      normalizeProviderSnapshot(
        await provider.getCall(creation.providerCallId),
      ).doNotCallRequested,
    ).toBe(true);
  });
});

function createRequest() {
  return {
    attemptId: "attempt-fake-provider-test",
    idempotencyKey: "attempt-fake-provider-test",
    brief: {
      caseId: "case-fake-provider-test",
      attemptId: "attempt-fake-provider-test",
      contractorDisplayName: "Example HVAC",
      workOrderRef: "WO-FAKE-PROVIDER-TEST",
      recipient: {
        nameOrRole: "Authorized site role",
        phoneE164: "+12025550142",
        timezone: "America/Chicago",
      },
      disclosure: "I am an AI assistant calling on behalf of Example HVAC.",
      objective: "Collect approved closeout information.",
      allowedReferenceText: "A fictional technician visited RTU-2.",
      questions: ["observed_operating_status"],
      prohibitedActions: ["diagnose_equipment"],
      voicemailPolicy: "do_not_leave",
      maxBoundedClarificationsPerQuestion: 1,
    } satisfies ApprovedCallBrief,
  };
}
