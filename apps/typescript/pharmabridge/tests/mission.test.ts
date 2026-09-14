import { describe, expect, it } from "vitest";
import { derivePhase } from "@/lib/mission";
import type { CallAttemptView, CallEventView, CallView } from "@/lib/types";

// Shapes and messages mirror a real live CALL-E call observed on 2026-09-14.
function call(status: CallView["status"], attemptStatus: CallAttemptView["status"] | null, turns = 0): CallView {
  return {
    id: "call_live",
    status,
    structuredResult: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    metadata: {},
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-09-14T06:38:23Z",
    completedAt: null,
    simulated: false,
    attempts: attemptStatus
      ? [
          {
            id: "att_live",
            status: attemptStatus,
            startedAt: null,
            completedAt: null,
            summary: null,
            transcriptTurns: Array.from({ length: turns }, () => ({ offsetSeconds: 0, speaker: "user" as const, text: "Blood bank, Priya speaking." })),
            providerCallId: null,
            failureCode: null,
            failureMessage: null,
          },
        ]
      : [],
  };
}

const event = (message: string): CallEventView => ({ id: message, type: "call.updated", level: "info", message, createdAt: "2026-09-14T06:38:58Z" });

describe("live CALL-E phase mapping", () => {
  it("waits for CALL-E before the first attempt exists", () => {
    expect(derivePhase(call("queued", null), [])).toBe("launching");
  });

  it("shows ringing even while CALL-E still reports the task as queued", () => {
    expect(derivePhase(call("queued", "in_progress"), [event("calling task status=calling"), event("Call is ringing.")])).toBe("dialing");
  });

  it("treats transcript turns as a live conversation", () => {
    expect(derivePhase(call("in_progress", "in_progress", 2), [event("Call is ringing.")])).toBe("talking");
  });

  it("moves to extraction once the call ends", () => {
    expect(derivePhase(call("queued", "in_progress"), [event("Call is ringing."), event("Call ended; syncing final Calling result.")])).toBe("extracting");
  });

  it("reports failed and completed live calls as terminal", () => {
    expect(derivePhase(call("failed", "failed"), [])).toBe("failed");
    expect(derivePhase(call("completed", "completed"), [])).toBe("done");
  });
});
