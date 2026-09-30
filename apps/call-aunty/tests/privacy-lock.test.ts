import { describe, expect, it } from "vitest";
import { parsePrivacyLock } from "../lib/privacy-lock-utils";

describe("privacy lock", () => {
  it("only treats the explicit locked value as locked", () => {
    expect(parsePrivacyLock("locked")).toBe(true);
    expect(parsePrivacyLock("unlocked")).toBe(false);
    expect(parsePrivacyLock(null)).toBe(false);
  });
});
