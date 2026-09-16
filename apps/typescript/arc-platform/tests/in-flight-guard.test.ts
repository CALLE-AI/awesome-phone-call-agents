import { describe, it, expect } from "vitest";
import { inFlightMessage } from "@/lib/calls";

/**
 * A call once went queued and never dialled. The next three calls to that
 * number each came back 486 "Busy Here" in the same second they started.
 * The busy line was ours.
 */
describe("the card says why a call was not placed", () => {
  it("names the number as still waiting, not as failed", () => {
    const m = inFlightMessage({ targetName: null, startedAt: new Date(Date.now() - 60_000) });
    expect(m).toContain("still waiting to dial");
    expect(m.toLowerCase()).not.toContain("failed");
  });

  it("says how long ago, so the wait is legible", () => {
    expect(inFlightMessage({ targetName: null, startedAt: new Date(Date.now() - 5 * 60_000) }))
      .toContain("5 minutes ago");
    expect(inFlightMessage({ targetName: null, startedAt: new Date(Date.now() - 60_000) }))
      .toContain("1 minute ago");
  });

  it("names the target when it is the caller's own call", () => {
    expect(inFlightMessage({ targetName: "FM 100", startedAt: new Date() })).toContain("FM 100");
  });

  it("says nothing about another brand's target", () => {
    // inFlightCallTo nulls the name across brands; the line is busy either
    // way, but whose call it is is not this caller's business.
    expect(inFlightMessage({ targetName: null, startedAt: new Date() })).not.toContain("(");
  });
});
