import { afterEach, describe, expect, it } from "vitest";
import { recordsAccessAllowed } from "@/lib/config";
import { redactDeep, redactPhones } from "@/lib/phone";
import { calleBaseUrl } from "@/lib/transport";

describe("phone masking", () => {
  it("masks phone numbers in free text", () => {
    expect(redactPhones("Call +1 (212) 555-0110 or +919042537133")).toBe("Call ••• ••• ••10 or ••• ••• ••33");
    expect(redactPhones("pharmacy phone (212) 555-0110.")).toBe("pharmacy phone ••• ••• ••10.");
    expect(redactPhones("reach me on 9042537133")).toBe("reach me on ••• ••• ••33");
  });

  it("leaves dates, references, prices, and ids alone", () => {
    const text = "DOB 2021-04-12, hold H-4821, store #2214, $18.40, osm:node/6891234502, provider 9a9adaad8937479f91fd378c8fc49049, 2026-09-14T06:38:54Z";
    expect(redactPhones(text)).toBe(text);
  });

  it("masks every string inside a nested value", () => {
    expect(redactDeep({ a: ["+12125550110"], b: { c: "x +12125550110" }, n: 5, ok: true })).toEqual({ a: ["••• ••• ••10"], b: { c: "x ••• ••• ••10" }, n: 5, ok: true });
  });
});

describe("call records access", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("needs the operator code in every environment", () => {
    process.env.PHARMABRIDGE_OPERATOR_CODE = "secret-code";
    for (const env of ["development", "production", "test"]) {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
      expect(recordsAccessAllowed(null)).toBe(false);
      expect(recordsAccessAllowed("wrong-code")).toBe(false);
      expect(recordsAccessAllowed("secret-code")).toBe(true);
    }
  });

  it("stays closed when no operator code is configured", () => {
    delete process.env.PHARMABRIDGE_OPERATOR_CODE;
    expect(recordsAccessAllowed(null)).toBe(false);
    expect(recordsAccessAllowed("")).toBe(false);
  });
});

describe("CALL-E credential transport", () => {
  it("keeps the SDK default when no base URL is configured", () => {
    expect(calleBaseUrl({})).toBeUndefined();
  });

  it("accepts only the official HTTPS origin", () => {
    expect(calleBaseUrl({ CALLE_BASE_URL: "https://api.heycall-e.com/" })).toBe("https://api.heycall-e.com");
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "https://api.heycall-e.com.evil.test" })).toThrow();
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "http://api.heycall-e.com" })).toThrow();
  });

  it("allows a loopback test transport only when explicitly enabled", () => {
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "http://127.0.0.1:8787" })).toThrow();
    expect(calleBaseUrl({ CALLE_BASE_URL: "http://127.0.0.1:8787", CALLE_LOCAL_TEST_TRANSPORT: "true", CALLE_API_KEY: "local-test-only" })).toBe("http://127.0.0.1:8787");
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "http://127.0.0.1:8787", CALLE_LOCAL_TEST_TRANSPORT: "true", CALLE_API_KEY: "synthetic-non-test-key" })).toThrow();
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "http://127.0.0.1:8787", CALLE_LOCAL_TEST_TRANSPORT: "true" })).toThrow();
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "http://10.0.0.5:8787", CALLE_LOCAL_TEST_TRANSPORT: "true" })).toThrow();
  });

  it("rejects URLs that carry credentials, a query, or a fragment", () => {
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "https://user:pw@api.heycall-e.com" })).toThrow();
    expect(() => calleBaseUrl({ CALLE_BASE_URL: "https://api.heycall-e.com/?next=https://evil.test" })).toThrow();
  });
});
