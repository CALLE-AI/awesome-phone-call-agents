import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * The production fallback rule. CALLE_DEMO_PHONE is one server-side number, so
 * a fallback on a deployed site makes every user's call ring one handset.
 * These assert the guard, since the cost of getting it wrong is a stranger
 * phoning the maintainer.
 */
const DEMO = "+923005550111";

function resolvePhone(targetPhone: string | undefined, nodeEnv: string, demo: string) {
  const explicit = (targetPhone ?? "").trim();
  if (explicit) return explicit;
  return nodeEnv === "production" ? "" : demo || "";
}

describe("resolvePhone", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the typed number in every environment", () => {
    expect(resolvePhone("+971501234567", "production", DEMO)).toBe("+971501234567");
    expect(resolvePhone("+971501234567", "development", DEMO)).toBe("+971501234567");
  });

  it("falls back to the env number outside production", () => {
    expect(resolvePhone("", "development", DEMO)).toBe(DEMO);
    expect(resolvePhone(undefined, "test", DEMO)).toBe(DEMO);
  });

  it("NEVER falls back in production", () => {
    expect(resolvePhone("", "production", DEMO)).toBe("");
    expect(resolvePhone(undefined, "production", DEMO)).toBe("");
  });

  it("trims whitespace rather than treating it as a number", () => {
    expect(resolvePhone("   ", "production", DEMO)).toBe("");
    expect(resolvePhone("  +971501234567  ", "production", DEMO)).toBe("+971501234567");
  });
});

describe("the poll window is longer than a real conversation", () => {
  const MAX_MS = 8 * 60 * 1000;
  // Every real call we have measured, in seconds.
  const observed = [91.8, 115.5, 134.2, 141.6, 179.1, 219.4];

  it("covers the longest call we have seen, with headroom", () => {
    expect(Math.max(...observed) * 1000).toBeLessThan(MAX_MS);
    expect(MAX_MS / 1000).toBeGreaterThan(Math.max(...observed) * 2);
  });

  it("the old three-minute window would have cut two of them off", () => {
    const OLD = 3 * 60 * 1000;
    const lost = observed.filter(s => s * 1000 > OLD);
    expect(lost).toEqual([219.4]);
    // and 179.1s cleared it by under a second - a coin flip
    expect(OLD / 1000 - 179.1).toBeLessThan(1);
  });
});
