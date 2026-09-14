import { describe, expect, it } from "vitest";

import {
  isPhoneProtectionReady,
  resolvePhoneProtectionKeys,
} from "@/config/phone-protection-environment";

const dataKey = Buffer.alloc(32, 21).toString("base64");
const lookupKey = Buffer.alloc(32, 22).toString("base64");

describe("phone protection environment", () => {
  it("stays unconfigured when both secrets are absent", () => {
    expect(resolvePhoneProtectionKeys({})).toBeNull();
  });

  it("loads separate canonical keys and a version", () => {
    expect(
      resolvePhoneProtectionKeys({
        FIELDCLOSE_DATA_KEY: dataKey,
        FIELDCLOSE_LOOKUP_KEY: lookupKey,
        FIELDCLOSE_PHONE_KEY_VERSION: "test-v2",
      }),
    ).toMatchObject({ keyVersion: "test-v2" });
  });

  it("rejects partial, malformed, or reused secrets", () => {
    expect(() =>
      resolvePhoneProtectionKeys({ FIELDCLOSE_DATA_KEY: dataKey }),
    ).toThrow(/configured together/);
    expect(() =>
      resolvePhoneProtectionKeys({
        FIELDCLOSE_DATA_KEY: "not-a-key",
        FIELDCLOSE_LOOKUP_KEY: lookupKey,
      }),
    ).toThrow(/canonical base64/);
    expect(() =>
      resolvePhoneProtectionKeys({
        FIELDCLOSE_DATA_KEY: dataKey,
        FIELDCLOSE_LOOKUP_KEY: dataKey,
      }),
    ).toThrow(/must be different/);
  });

  it("reports bounded readiness without throwing configuration details", () => {
    expect(isPhoneProtectionReady({})).toBe(false);
    expect(
      isPhoneProtectionReady({
        FIELDCLOSE_DATA_KEY: "not-a-key",
        FIELDCLOSE_LOOKUP_KEY: lookupKey,
      }),
    ).toBe(false);
    expect(
      isPhoneProtectionReady({
        FIELDCLOSE_DATA_KEY: dataKey,
        FIELDCLOSE_LOOKUP_KEY: lookupKey,
      }),
    ).toBe(true);
  });
});
