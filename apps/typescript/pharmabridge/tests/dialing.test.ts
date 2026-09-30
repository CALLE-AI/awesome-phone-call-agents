import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveEnabled, resolveDialTarget } from "@/lib/config";
import { signFacility, verifyFacility } from "@/lib/discovery-signing";

// All numbers are fictional (NANP 555-01xx).
const facility = { id: "osm:node/1", kind: "pharmacy", name: "Test Pharmacy", phone: "+12125550142" };
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PHARMABRIDGE_LIVE_CALLS = "true";
  process.env.CALLE_API_KEY = "test-key";
  process.env.PHARMABRIDGE_OPERATOR_CODE = "operator-code";
  process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET = "s".repeat(43);
  process.env.PHARMABRIDGE_ALLOWED_NUMBERS = "+12125550199";
  delete process.env.PHARMABRIDGE_DIRECT_CALLS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("discovery signatures", () => {
  it("verify only the exact facility and number they were issued for", () => {
    const signature = signFacility(facility);
    expect(verifyFacility(facility, signature)).toBe(true);
    expect(verifyFacility({ ...facility, phone: "+12125550100" }, signature)).toBe(false);
    expect(verifyFacility({ ...facility, name: "Someone Else" }, signature)).toBe(false);
    expect(verifyFacility(facility, "9999999999.bogus")).toBe(false);
  });

  it("are never issued without a signing secret or a phone number", () => {
    expect(signFacility({ ...facility, phone: null })).toBeNull();
    delete process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET;
    expect(signFacility(facility)).toBeNull();
  });
});

describe("dial policy", () => {
  const direct = { routing: "direct" as const, listedPhone: facility.phone, listedVerified: true, directConsent: true, testLineIndex: 0 };

  it("dials a verified listed number only with operator consent", () => {
    expect(resolveDialTarget(direct)).toMatchObject({ ok: true, phone: facility.phone });
    expect(resolveDialTarget({ ...direct, directConsent: false }).ok).toBe(false);
    expect(resolveDialTarget({ ...direct, listedVerified: false }).ok).toBe(false);
    expect(resolveDialTarget({ ...direct, listedPhone: "12345" }).ok).toBe(false);
  });

  it("routes test-line calls to the allowlist, never to the listed number", () => {
    expect(resolveDialTarget({ ...direct, routing: "test_line" })).toMatchObject({ ok: true, phone: "+12125550199" });
  });

  it("refuses direct calls when direct mode or live mode is off", () => {
    process.env.PHARMABRIDGE_DIRECT_CALLS = "false";
    expect(resolveDialTarget(direct).ok).toBe(false);
    process.env.PHARMABRIDGE_DIRECT_CALLS = "true";
    process.env.PHARMABRIDGE_LIVE_CALLS = "false";
    expect(liveEnabled()).toBe(false);
    expect(resolveDialTarget(direct).ok).toBe(false);
  });

  it("requires the operator code and signing secret before anything is live", () => {
    delete process.env.PHARMABRIDGE_OPERATOR_CODE;
    expect(liveEnabled()).toBe(false);
  });

  it("never dials in simulation", () => {
    expect(resolveDialTarget({ ...direct, routing: "simulation" }).ok).toBe(false);
  });
});
