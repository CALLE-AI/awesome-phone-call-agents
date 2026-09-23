import { describe, expect, it } from "vitest";
import { DEFAULT_APP_LOCK_TIMEOUT_MS, shouldLockAfterBackground } from "../lib/app-lock";

describe("app lock", () => {
  it("locks after the configured background timeout", () => {
    expect(shouldLockAfterBackground(1000, 1000 + DEFAULT_APP_LOCK_TIMEOUT_MS)).toBe(true);
    expect(shouldLockAfterBackground(1000, 1000 + DEFAULT_APP_LOCK_TIMEOUT_MS - 1)).toBe(false);
  });

  it("does not lock when there was no recorded background transition", () => {
    expect(shouldLockAfterBackground(null, Date.now())).toBe(false);
  });
});
