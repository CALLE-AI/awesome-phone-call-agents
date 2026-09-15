import { describe, expect, it } from "vitest";

import {
  OFFICIAL_CALLE_BASE_URL,
  resolveCalleBaseUrl,
} from "./config";

describe("resolveCalleBaseUrl", () => {
  it.each([
    undefined,
    "",
    "https://api.heycall-e.com",
    "https://api.heycall-e.com/",
  ])("accepts the official CALL-E origin: %s", (value) => {
    expect(resolveCalleBaseUrl(value, "production")).toBe(
      OFFICIAL_CALLE_BASE_URL,
    );
  });

  it.each([
    "http://api.heycall-e.com",
    "https://api.heycall-e.com.attacker.test",
    "https://api.heycall-e.com/v1",
    "https://api.heycall-e.com?key=value",
    "https://user@example.com",
    "not a url",
  ])("rejects an unsafe or malformed origin: %s", (value) => {
    expect(() => resolveCalleBaseUrl(value, "production")).toThrow(
      /CALLE_BASE_URL/,
    );
  });

  it.each([
    "http://127.0.0.1:4312",
    "http://localhost:4312",
    "http://[::1]:4312",
  ])("accepts exact loopback HTTP outside production: %s", (value) => {
    expect(resolveCalleBaseUrl(value, "test")).toBe(value);
    expect(() => resolveCalleBaseUrl(value, "production")).toThrow(
      /CALLE_BASE_URL/,
    );
  });

  it("rejects loopback lookalikes", () => {
    expect(() =>
      resolveCalleBaseUrl("http://localhost.attacker.test:4312", "test"),
    ).toThrow(/CALLE_BASE_URL/);
  });
});
