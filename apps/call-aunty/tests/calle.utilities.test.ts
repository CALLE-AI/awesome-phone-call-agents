import { describe, expect, it } from "vitest";

import {
  CircuitBreaker,
  redactObject,
  sanitizeText,
  SlidingWindowLimiter,
} from "../server/calle/utilities";

describe("CALL-E utilities", () => {
  it("rate limits", () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.allow(1000)).toBe(true);
    expect(limiter.allow(1001)).toBe(true);
    expect(limiter.allow(1002)).toBe(false);
    expect(limiter.allow(2001)).toBe(true);
  });

  it("opens circuit", () => {
    const breaker = new CircuitBreaker(2, 100);
    breaker.failure(0);
    breaker.failure(1);
    expect(breaker.canExecute(50)).toBe(false);
    expect(breaker.canExecute(102)).toBe(true);
  });

  it("sanitizes logs", () => {
    expect(sanitizeText("Bearer topsecret 4111111111111111")).toBe("Bearer [REDACTED] [REDACTED]");
  });

  it("redacts sensitive object fields", () => {
    expect(redactObject({ phone: "+14165550123", nested: { apiKey: "secret" } })).toEqual({
      phone: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" },
    });
  });
});
