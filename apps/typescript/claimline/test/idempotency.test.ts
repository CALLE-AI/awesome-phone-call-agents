import { describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "../src/domain/idempotency.js";

describe("idempotency", () => {
  const base = {
    claimId: "claim-1",
    callType: "fnol_intake" as const,
    destinationPhone: "+15550123456",
    schemaVersion: "fnol.v1",
  };

  it("is stable for identical authorized intent", () => {
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
  });

  it("changes when any component changes", () => {
    const key = deriveIdempotencyKey(base);
    expect(deriveIdempotencyKey({ ...base, claimId: "claim-2" })).not.toBe(key);
    expect(deriveIdempotencyKey({ ...base, callType: "status_chase" })).not.toBe(key);
    expect(deriveIdempotencyKey({ ...base, destinationPhone: "+15550000000" })).not.toBe(key);
    expect(deriveIdempotencyKey({ ...base, schemaVersion: "fnol.v2" })).not.toBe(key);
  });

  it("embeds the call type for readability", () => {
    expect(deriveIdempotencyKey(base)).toMatch(/^claimline_fnol_intake_/);
  });
});
