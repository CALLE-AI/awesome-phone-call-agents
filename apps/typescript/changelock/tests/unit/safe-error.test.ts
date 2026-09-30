import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "../../src/application/safe-error";

describe("safeErrorMessage", () => {
  it("returns only the fallback for arbitrary internal or secret-bearing errors", () => {
    const secret = ["iams", "live", "abcdef1234567890"].join("_");
    expect(safeErrorMessage(new Error(`provider auth failed with ${secret}`))).not.toContain(secret);
    expect(safeErrorMessage(new Error(`provider auth failed with ${secret}`))).toBe(
      "The action failed safely.",
    );
    expect(safeErrorMessage(new Error("ECONNREFUSED 10.0.0.4:443"))).toBe(
      "The action failed safely.",
    );
    expect(safeErrorMessage("not an error object")).toBe("The action failed safely.");
  });

  it("passes through known operator-actionable messages", () => {
    expect(
      safeErrorMessage(new Error('typed phrase must be exactly "VERIFY CL-8FF97B"')),
    ).toBe('typed phrase must be exactly "VERIFY CL-8FF97B"');
    expect(
      safeErrorMessage(new Error("preview missing or expired; regenerate before authorizing")),
    ).toContain("preview");
    expect(
      safeErrorMessage(new Error("authorization expired; create a new preview and re-authorize")),
    ).toContain("authorization expired");
    expect(safeErrorMessage(new Error("an intent is already active for this case"))).toContain(
      "already active",
    );
    expect(safeErrorMessage(new Error("case not found"))).toBe("case not found");
    expect(safeErrorMessage(new Error("cannot authorize in state call_active"))).toContain(
      "cannot authorize",
    );
  });
});
