import { describe, it, expect } from "vitest";

import {
  APPROVED_CALLE_ORIGINS,
  DEFAULT_CALLE_BASE_URL,
  resolveCalleBaseUrl,
} from "@/lib/calle";

/**
 * The CALL-E API key is sent to whatever CALLE_BASE_URL resolves to. These
 * tests are about the one question that matters: can an environment variable
 * alone move the credential somewhere it should not go.
 */
describe("resolveCalleBaseUrl", () => {
  it("defaults when unset, empty or whitespace", () => {
    expect(resolveCalleBaseUrl(undefined)).toBe(DEFAULT_CALLE_BASE_URL);
    expect(resolveCalleBaseUrl("")).toBe(DEFAULT_CALLE_BASE_URL);
    expect(resolveCalleBaseUrl("   ")).toBe(DEFAULT_CALLE_BASE_URL);
  });

  it("accepts the approved origin, with or without a trailing slash", () => {
    expect(resolveCalleBaseUrl("https://api.heycall-e.com")).toBe("https://api.heycall-e.com");
    expect(resolveCalleBaseUrl("https://api.heycall-e.com/")).toBe("https://api.heycall-e.com");
  });

  it("refuses plain http, even to the approved host", () => {
    expect(() => resolveCalleBaseUrl("http://api.heycall-e.com")).toThrow(/https/);
  });

  it("refuses an unapproved origin", () => {
    expect(() => resolveCalleBaseUrl("https://api.example.com")).toThrow(/not approved/);
  });

  /* A lookalike host is the case this exists for: it parses, it is https, and
     it is not the API. */
  it("refuses a lookalike host and a subdomain of the approved one", () => {
    expect(() => resolveCalleBaseUrl("https://api.heycall-e.com.evil.test")).toThrow(/not approved/);
    expect(() => resolveCalleBaseUrl("https://evil.api.heycall-e.com")).toThrow(/not approved/);
  });

  it("refuses a different port on the approved host", () => {
    expect(() => resolveCalleBaseUrl("https://api.heycall-e.com:8443")).toThrow(/not approved/);
  });

  it("refuses something that is not a URL at all", () => {
    expect(() => resolveCalleBaseUrl("api.heycall-e.com")).toThrow(/not a valid URL/);
  });

  /* Returning the origin rather than the input is what drops these. A path
     would be harmless; embedded credentials would not be. */
  it("strips path, query and embedded credentials", () => {
    expect(resolveCalleBaseUrl("https://api.heycall-e.com/v1?k=1")).toBe("https://api.heycall-e.com");
    expect(resolveCalleBaseUrl("https://user:pass@api.heycall-e.com")).toBe("https://api.heycall-e.com");
  });

  it("keeps the allowlist https-only, so no entry can leak the key in clear", () => {
    for (const origin of APPROVED_CALLE_ORIGINS) {
      expect(new URL(origin).protocol).toBe("https:");
    }
  });
});
