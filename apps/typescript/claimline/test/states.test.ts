import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminalState,
} from "../src/domain/states.js";

describe("state machine", () => {
  it("allows the documented forward path", () => {
    expect(canTransition("reserved", "accepted")).toBe(true);
    expect(canTransition("accepted", "terminal_unverified")).toBe(true);
    expect(canTransition("terminal_unverified", "terminal_verified")).toBe(true);
    expect(canTransition("terminal_verified", "applied")).toBe(true);
    expect(canTransition("needs_human", "applied")).toBe(true);
    expect(canTransition("reserved", "canceled")).toBe(true);
  });

  it("rejects skips and backward moves", () => {
    expect(canTransition("reserved", "terminal_verified")).toBe(false);
    expect(canTransition("accepted", "applied")).toBe(false);
    expect(canTransition("terminal_verified", "reserved")).toBe(false);
    expect(canTransition("applied", "needs_human")).toBe(false);
    expect(canTransition("canceled", "accepted")).toBe(false);
  });

  it("assertTransition throws on an illegal move", () => {
    expect(() => assertTransition("reserved", "applied")).toThrow(/Illegal/);
  });

  it("marks terminal states", () => {
    expect(isTerminalState("applied")).toBe(true);
    expect(isTerminalState("canceled")).toBe(true);
    expect(isTerminalState("needs_human")).toBe(false);
  });
});
