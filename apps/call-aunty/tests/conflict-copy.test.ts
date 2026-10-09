import { describe, expect, it } from "vitest";
import { getAppCopy } from "../lib/app-copy";

describe("conflict confirmation copy", () => {
  it("formats singular and plural English conflict counts", () => {
    const copy = getAppCopy("en");
    expect(copy.reconciliationAcceptSummary(1)).toBe("1 newer local change will be replaced.");
    expect(copy.reconciliationAcceptSummary(2)).toBe("2 newer local changes will be replaced.");
  });

  it("formats Bangla conflict counts and keeps confirmation guidance present", () => {
    const copy = getAppCopy("bn");
    expect(copy.reconciliationAcceptSummary(2)).toContain("2টি");
    expect(copy.reconciliationConfirmHint.length).toBeGreaterThan(0);
  });
});
