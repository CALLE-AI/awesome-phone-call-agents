import { describe, expect, it } from "vitest";
import { formatAppLockTimeout, parseAppLockTimeout } from "../lib/app-lock-preferences";

describe("app lock preferences", () => {
  it("accepts supported timeout values and defaults unknown values", () => {
    expect(parseAppLockTimeout("300000")).toBe(300000);
    expect(parseAppLockTimeout("999")).toBe(60000);
    expect(parseAppLockTimeout(null)).toBe(60000);
  });

  it("formats timeout copy for Settings", () => {
    expect(formatAppLockTimeout(60000)).toBe("1 minute");
    expect(formatAppLockTimeout(900000)).toBe("15 minutes");
  });
});
