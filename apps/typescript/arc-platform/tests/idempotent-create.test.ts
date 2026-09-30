import { describe, it, expect } from "vitest";
import { isAmbiguousCreateError, AMBIGUOUS, RESERVING } from "@/lib/calls";

/**
 * The question this function answers is the whole of the fix: did the call
 * possibly get placed?
 *
 * Answer "no" wrongly and the next click dials a real station a second time.
 * Answer "yes" wrongly and someone has to resolve a reservation by hand. The
 * costs are not symmetric, so anything unrecognised is ambiguous.
 */
describe("isAmbiguousCreateError", () => {
  it("treats a timeout as ambiguous - the call may already be dialling", () => {
    const e = new Error("The operation timed out");
    e.name = "TimeoutError";
    expect(isAmbiguousCreateError(e)).toBe(true);
  });

  it("treats an abort as ambiguous", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isAmbiguousCreateError(e)).toBe(true);
  });

  /* The exact wording lib/calle.ts throws on its own fetch timeout. If this
     stops matching, a timeout starts looking like a clean failure. */
  it("recognises our own timeout message", () => {
    expect(
      isAmbiguousCreateError(new Error("CALL-E did not respond within 30s (placing the call)."))
    ).toBe(true);
  });

  it("treats 5xx, 408 and 429 as ambiguous", () => {
    for (const status of [500, 502, 503, 504, 408, 429]) {
      expect(isAmbiguousCreateError(Object.assign(new Error("x"), { status }))).toBe(true);
    }
  });

  /* A rejected request never reached a handset, so the reservation can be
     closed and the number freed. */
  it("treats a 4xx rejection as definite", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isAmbiguousCreateError(Object.assign(new Error("x"), { status }))).toBe(false);
    }
  });

  it("treats network-shaped failures as ambiguous", () => {
    for (const m of ["fetch failed", "ECONNRESET", "ETIMEDOUT", "socket hang up", "network error"]) {
      expect(isAmbiguousCreateError(new Error(m))).toBe(true);
    }
  });

  /* Fail safe. An error nobody anticipated must not be read as "nothing
     happened" - that reading is what places the second call. */
  it("treats an unrecognised error as ambiguous rather than as a clean failure", () => {
    expect(isAmbiguousCreateError(new Error("something nobody predicted"))).toBe(true);
    expect(isAmbiguousCreateError("a string")).toBe(true);
    expect(isAmbiguousCreateError(null)).toBe(true);
  });
});

describe("reservation statuses", () => {
  /* Both must stay done:false so inFlightCallTo keeps blocking the number.
     These constants are what the routes branch on. */
  it("are distinct and stable", () => {
    expect(RESERVING).toBe("reserving");
    expect(AMBIGUOUS).toBe("ambiguous");
    expect(RESERVING).not.toBe(AMBIGUOUS);
  });
});
