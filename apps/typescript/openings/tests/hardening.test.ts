import { describe, expect, it } from "vitest";
import { assertAllowedCalleBaseUrl, DEFAULT_CALLE_BASE_URL } from "../src/core/calle";
import { hasAuthSecret, isValidAuthHeader, readAuthSecret, safeEqual } from "../src/core/auth";
import { resolveConfig } from "../src/app/config";

describe("CALLE base URL pinning", () => {
  it("accepts exactly the official HTTPS origin", () => {
    expect(() => assertAllowedCalleBaseUrl(undefined)).not.toThrow();
    expect(() => assertAllowedCalleBaseUrl("https://api.heycall-e.com")).not.toThrow();
  });

  it("rejects other hosts, ports, paths, and schemes", () => {
    expect(() => assertAllowedCalleBaseUrl("https://api.heycall-e.com.evil.test")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("https://api.heycall-e.com:8443")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("https://api.heycall-e.com/proxy")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("https://api.heycall-e.com/?x=1")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("http://api.heycall-e.com")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("https://heycall-e.com")).toThrow();
    expect(() => assertAllowedCalleBaseUrl("not a url")).toThrow();
  });

  it("defaults to the official origin", () => {
    expect(DEFAULT_CALLE_BASE_URL).toBe("https://api.heycall-e.com");
  });
});

describe("auth secret parsing", () => {
  it("reads token form", () => {
    const s = readAuthSecret({ OPENINGS_AUTH_TOKEN: "abc" });
    expect(s.kind).toBe("token");
    expect(hasAuthSecret(s)).toBe(true);
  });

  it("reads basic user:pass form", () => {
    const s = readAuthSecret({ OPENINGS_BASIC_AUTH: "admin:s3cret" });
    expect(s.kind).toBe("basic");
    if (s.kind !== "basic") return;
    expect(s.user).toBe("admin");
    expect(s.password).toBe("s3cret");
  });

  it("is none when nothing is set", () => {
    expect(readAuthSecret({}).kind).toBe("none");
    expect(hasAuthSecret(readAuthSecret({}))).toBe(false);
  });

  it("validates headers against the secret", () => {
    const s = readAuthSecret({ OPENINGS_AUTH_TOKEN: "tok" });
    expect(isValidAuthHeader("Bearer tok", s)).toBe(true);
    expect(isValidAuthHeader(`Basic ${Buffer.from("user:tok").toString("base64")}`, s)).toBe(true);
    expect(isValidAuthHeader("Bearer wrong", s)).toBe(false);
    expect(isValidAuthHeader(null, s)).toBe(false);
  });
});

describe("timing-safe compare", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("fail-closed live mode", () => {
  it("refuses to resolve live config without an auth secret", () => {
    const prev = { ...process.env };
    process.env.OPENINGS_CALL_MODE = "live";
    process.env.CALLE_API_KEY = "key";
    delete process.env.OPENINGS_AUTH_TOKEN;
    delete process.env.OPENINGS_BASIC_AUTH;
    delete process.env.OPENINGS_STORE;
    try {
      expect(() => resolveConfig()).toThrow(/auth secret/i);
    } finally {
      for (const k of Object.keys(prev)) process.env[k] = prev[k]!;
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
    }
  });

  it("resolves live config when an auth secret is present (memory store)", () => {
    const prev = { ...process.env };
    process.env.OPENINGS_CALL_MODE = "live";
    process.env.CALLE_API_KEY = "key";
    process.env.OPENINGS_AUTH_TOKEN = "tok";
    process.env.OPENINGS_STORE = "memory";
    try {
      expect(() => resolveConfig()).not.toThrow();
    } finally {
      for (const k of Object.keys(prev)) process.env[k] = prev[k]!;
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
    }
  });
});
