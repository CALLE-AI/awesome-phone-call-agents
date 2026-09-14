import { describe, expect, it } from "vitest";
import { derivePhase, markUnknown, newSlot, PHASE_META, submissionOutcome, withLiveTurns } from "@/lib/mission";
import type { CallAttemptView, CallEventView, CallView, Facility } from "@/lib/types";

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

describe("live conversation from CALL-E speech events", () => {
  // Messages observed on the completed live test-line call of 2026-09-14 (provider 9a9adaad…).
  const speech = [
    event("Call is ringing."),
    event("Callee interrupted: Hi, this is an a ... [interrupted]"),
    event("Callee said: I'm an a"),
    event("Bot is speaking: and could you fill one one hundred milliliter bottle today?"),
    event("Callee said: I'm an a I'm not sure"),
  ];

  it("rebuilds the conversation before the transcript arrives", () => {
    const view = withLiveTurns(call("queued", "in_progress"), speech);
    expect(view.attempts[0].transcriptTurns.map((t) => [t.speaker, t.text])).toEqual([
      ["bot", "Hi, this is an a…"],
      ["user", "I'm an a"],
      ["bot", "and could you fill one one hundred milliliter bottle today?"],
      ["user", "I'm an a I'm not sure"],
    ]);
    expect(derivePhase(view, speech)).toBe("talking");
  });

  it("merges an utterance reported several times as it grows", () => {
    const view = withLiveTurns(call("queued", "in_progress"), [event("Callee said: We have"), event("Callee said: We have two bottles")]);
    expect(view.attempts[0].transcriptTurns.map((t) => t.text)).toEqual(["We have two bottles"]);
  });

  it("leaves real transcripts and finished calls untouched", () => {
    const withTranscript = call("in_progress", "in_progress", 2);
    expect(withLiveTurns(withTranscript, speech)).toBe(withTranscript);
    const done = call("completed", "completed");
    expect(withLiveTurns(done, speech)).toBe(done);
  });
});

const facility = (i: number): Facility => ({
  id: `synthetic:pharmacy:${i}`,
  kind: "pharmacy",
  name: `Pharmacy ${i}`,
  brand: null,
  address: "",
  lat: 0,
  lon: 0,
  distanceKm: i,
  bearingDeg: 0,
  phone: null,
  phoneMasked: null,
  openingHours: null,
  source: "synthetic",
  mapsUrl: null,
  rating: null,
  openNow: null,
  signature: null,
});

describe("unknown call outcomes", () => {
  it("treats only a definite refusal as not placed", () => {
    expect(submissionOutcome(null)).toBe("unknown");
    expect(submissionOutcome(502, "upstream_error")).toBe("unknown");
    expect(submissionOutcome(502, "submission_unknown")).toBe("unknown");
    expect(submissionOutcome(409, "idempotency_conflict")).toBe("unknown");
    expect(submissionOutcome(408)).toBe("unknown");
    expect(submissionOutcome(403, "dial_refused")).toBe("rejected");
    expect(submissionOutcome(429, "daily_cap")).toBe("rejected");
  });

  it("halts queued live dispatch instead of freeing capacity for the next call", () => {
    const slots = [0, 1, 2].map((i) => newSlot(facility(i), i));
    slots[0].phase = "launching";
    const reason = markUnknown(slots, slots[0], "No response from the PharmaBridge server.", true);
    expect(slots.map((s) => s.phase)).toEqual(["unknown", "skipped", "skipped"]);
    expect(slots[1].error).toMatch(/dispatch halted/);
    expect(reason).toMatch(/Dispatch halted/);
    expect(PHASE_META.unknown.label).not.toMatch(/not placed/i);
  });

  it("keeps simulated missions running", () => {
    const slots = [0, 1].map((i) => newSlot(facility(i), i));
    expect(markUnknown(slots, slots[0], "lost", false)).toBeNull();
    expect(slots[1].phase).toBe("queued");
  });
});
