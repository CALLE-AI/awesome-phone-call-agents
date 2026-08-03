import { describe, expect, it } from "vitest";
import { mapCalleUpstreamError } from "../upstream-errors";

describe("mapCalleUpstreamError", () => {
  it("maps invalid token errors to 401", () => {
    const mapped = mapCalleUpstreamError(new Error("CALL-E MCP error 401: invalid_token"), "fallback");
    expect(mapped.status).toBe(401);
  });

  it("maps timeout-like errors to 504", () => {
    const mapped = mapCalleUpstreamError(new Error("request timeout while calling upstream"), "fallback");
    expect(mapped.status).toBe(504);
  });

  it("falls back to 502 with provided message", () => {
    const mapped = mapCalleUpstreamError(new Error("unexpected"), "Failed to plan call");
    expect(mapped.status).toBe(502);
    expect(mapped.message).toBe("Failed to plan call");
  });
});
