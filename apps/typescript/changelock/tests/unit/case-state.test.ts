import { describe, expect, it } from "vitest";
import {
  CASE_STATES,
  canTransition,
  assertTransition,
  type CaseState,
} from "../../src/domain/case-state";

describe("case state machine", () => {
  it("accepts the legal forward path", () => {
    const path: CaseState[] = [
      "needs_review",
      "preview_ready",
      "dispatch_reserved",
      "call_active",
      "terminal_unverified",
      "verification_confirmed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("accepts denied outcome", () => {
    expect(canTransition("terminal_unverified", "verification_denied")).toBe(true);
  });

  it("routes ambiguous acceptance to submission_unknown and allows later resolution", () => {
    expect(canTransition("dispatch_reserved", "submission_unknown")).toBe(true);
    expect(canTransition("submission_unknown", "call_active")).toBe(true);
    expect(canTransition("submission_unknown", "terminal_unverified")).toBe(true);
    expect(canTransition("submission_unknown", "needs_human")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    const illegal: [CaseState, CaseState][] = [
      ["needs_review", "call_active"],
      ["needs_review", "verification_confirmed"],
      ["preview_ready", "call_active"],
      ["preview_ready", "verification_denied"],
      ["call_active", "verification_confirmed"],
      ["verification_confirmed", "needs_review"],
      ["verification_denied", "needs_human"],
      ["needs_human", "dispatch_reserved"],
      ["submission_unknown", "dispatch_reserved"],
      ["dispatch_reserved", "terminal_unverified"],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow();
    }
  });

  it("marks verification states as terminal", () => {
    for (const s of ["verification_confirmed", "verification_denied", "needs_human"] as const) {
      expect(CASE_STATES[s].terminal).toBe(true);
      for (const t of Object.keys(CASE_STATES) as CaseState[]) {
        expect(canTransition(s, t)).toBe(false);
      }
    }
  });
});
