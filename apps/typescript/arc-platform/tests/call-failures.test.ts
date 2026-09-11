import { describe, it, expect } from "vitest";
import { describeFailure, regionForNumber, taskStatusOf } from "@/lib/call-failures";

/**
 * Every Arc-placed call came back status=failed, failureCode=486, and the card
 * said "the call didn't complete" - the same sentence a wrong number and a
 * refused route would have produced. The code was in the payload the whole
 * time and nothing read it.
 */
describe("the carrier's reason reaches the card", () => {
  it("explains 486 as busy-or-rejected, and says a retry is worth it", () => {
    const f = describeFailure("486")!;
    expect(f.title).toMatch(/busy/i);
    expect(f.retryable).toBe(true);
  });

  it("marks a number the carrier does not know as not worth retrying", () => {
    expect(describeFailure("404")!.retryable).toBe(false);
    expect(describeFailure("484")!.retryable).toBe(false);
    expect(describeFailure("403")!.retryable).toBe(false);
  });

  it("distinguishes no-answer from declined from unreachable", () => {
    const titles = ["487", "603", "480"].map((c) => describeFailure(c)!.title);
    expect(new Set(titles).size).toBe(3);
  });

  it("shows an unknown code as itself rather than swallowing it", () => {
    const f = describeFailure("599")!;
    expect(`${f.title} ${f.detail}`).toContain("599");
  });

  it("prefers CALL-E's own message when it sends one", () => {
    expect(describeFailure("486", "Carrier rejected: DND list")!.detail).toBe("Carrier rejected: DND list");
  });

  /**
   * 5 September. Two calls to the same handset eleven minutes apart, both
   * carrying "calling task status=NO ANSWER (Hangup by: bot)". One was headed
   * "Busy, or the handset rejected the call", the other "Phone unreachable",
   * because the carrier answered 486 for one and 480 for the other. Both rang
   * for eighty seconds, so neither heading was true - busy and rejected are
   * instant - and the reader went looking for a carrier rejection that had not
   * happened.
   */
  const NO_ANSWER = "calling task status=NO ANSWER (Hangup by: bot)";

  it("lets CALL-E's status outrank the SIP code's guess at the class", () => {
    expect(describeFailure("486", NO_ANSWER)!.title).toMatch(/nobody answered/i);
    expect(describeFailure("480", NO_ANSWER)!.title).toMatch(/nobody answered/i);
  });

  it("heads the same message the same way whatever code came with it", () => {
    const titles = ["486", "480", "487", null, "599"].map(
      (c) => describeFailure(c, NO_ANSWER)!.title
    );
    expect(new Set(titles).size).toBe(1);
  });

  it("never heads a no-answer as busy or rejected", () => {
    const f = describeFailure("486", NO_ANSWER)!;
    expect(f.title).not.toMatch(/busy|rejected/i);
  });


  /* Shown to someone standing next to a handset that had not rung. The API
     does not say whether the call reached the phone, so neither does the card. */
  it("does not claim the phone rang, because CALL-E never says that", () => {
    const f = describeFailure("486", NO_ANSWER)!;
    expect(f.detail).not.toMatch(/reached the phone and rang/i);
    expect(f.detail).toMatch(/does not report/i);
  });
  it("reads the status whatever the surrounding text", () => {
    expect(taskStatusOf(NO_ANSWER)).toBe("NO ANSWER");
    expect(taskStatusOf("calling task status=BUSY")).toBe("BUSY");
    expect(taskStatusOf("no status here")).toBeNull();
    expect(taskStatusOf(null)).toBeNull();
  });

  it("still falls back to the code when the message names no status", () => {
    const f = describeFailure("486", "Carrier rejected: DND list")!;
    expect(f.title).toMatch(/busy/i);
    expect(f.detail).toBe("Carrier rejected: DND list");
  });

  it("returns nothing when there is nothing to explain", () => {
    expect(describeFailure(null)).toBeNull();
    expect(describeFailure(undefined, null)).toBeNull();
  });
});

describe("the routing region we were never sending", () => {
  it("reads Pakistan from a +92 number", () => {
    expect(regionForNumber("+923005550000")).toBe("PK");
  });

  it("takes the longest matching prefix, not the first", () => {
    // +971 must not be read as +9-something, and never as +1.
    expect(regionForNumber("+971501234567")).toBe("AE");
    expect(regionForNumber("+14155550123")).toBe("US");
  });

  it("returns nothing for a country we have no entry for", () => {
    // Better to send no region than a wrong one: it is a routing and
    // compliance hint, and a wrong hint is worse than an absent one.
    expect(regionForNumber("+256700000000")).toBeUndefined();
  });
});
