import { describe, expect, it } from "vitest";

import {
  isHumanDispositionAllowed,
  parseHumanDispositionInput,
} from "@/application/human-disposition";

const taskId = "10000000-0000-4000-8000-000000000001";

describe("human disposition policy", () => {
  it.each([
    {
      outcome: "closeout_accepted" as const,
      taskType: "closeout_review" as const,
      resultRoute: "ready_for_closeout_review" as const,
      allowed: true,
    },
    {
      outcome: "return_visit_handoff" as const,
      taskType: "return_visit_review" as const,
      resultRoute: "return_visit_review" as const,
      allowed: true,
    },
    {
      outcome: "manual_follow_up_handoff" as const,
      taskType: "technical_review" as const,
      resultRoute: "human_follow_up" as const,
      allowed: true,
    },
    {
      outcome: "no_further_automated_action" as const,
      taskType: "privacy_request" as const,
      resultRoute: "human_follow_up" as const,
      allowed: true,
    },
    {
      outcome: "closeout_accepted" as const,
      taskType: "return_visit_review" as const,
      resultRoute: "return_visit_review" as const,
      allowed: false,
    },
    {
      outcome: "return_visit_handoff" as const,
      taskType: "contact_review" as const,
      resultRoute: "human_follow_up" as const,
      allowed: false,
    },
    {
      outcome: "manual_follow_up_handoff" as const,
      taskType: "closeout_review" as const,
      resultRoute: "ready_for_closeout_review" as const,
      allowed: false,
    },
  ])(
    "$outcome for $taskType and $resultRoute allowed=$allowed",
    ({ allowed, outcome, resultRoute, taskType }) => {
      expect(
        isHumanDispositionAllowed({ outcome, resultRoute, taskType }),
      ).toBe(allowed);
    },
  );

  it("requires a bounded note for human handoffs", () => {
    expect(() =>
      parseHumanDispositionInput({
        expectedCaseVersion: 1,
        taskId,
        outcome: "return_visit_handoff",
        resolutionNote: null,
      }),
    ).toThrow("requires a resolution note");

    expect(
      parseHumanDispositionInput({
        expectedCaseVersion: 1,
        taskId,
        outcome: "manual_follow_up_handoff",
        resolutionNote: "  Dispatch supervisor owns the follow-up.  ",
      }),
    ).toMatchObject({
      resolutionNote: "Dispatch supervisor owns the follow-up.",
    });
  });

  it("rejects unknown fields and accepts a note-free terminal stop", () => {
    expect(() =>
      parseHumanDispositionInput({
        expectedCaseVersion: 1,
        taskId,
        outcome: "no_further_automated_action",
        resolutionNote: null,
        actorId: "browser-controlled",
      } as never),
    ).toThrow();

    expect(
      parseHumanDispositionInput({
        expectedCaseVersion: 1,
        taskId,
        outcome: "no_further_automated_action",
        resolutionNote: null,
      }),
    ).toMatchObject({ outcome: "no_further_automated_action" });
  });
});
