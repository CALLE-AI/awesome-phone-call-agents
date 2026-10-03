// File: src/app/api/quotes/__tests__/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

let ipCounter = 0;
function req(body: unknown, ip?: string, token?: string): NextRequest {
  // Unique per-request IP by default so the per-IP rate limit never interferes across tests.
  const forwarded = ip ?? `10.0.0.${++ipCounter}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": forwarded,
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost:3000/api/quotes", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // Ensure mock mode (no live), independent of the machine's env.
  delete process.env.GOODFAITH_LIVE;
  delete process.env.CALLE_API_KEY;
  delete process.env.GOODFAITH_ALLOWED_RECIPIENTS;
  delete process.env.GOODFAITH_API_TOKEN;
});

describe("POST /api/quotes — validation (F-004, F-011)", () => {
  it("rejects an empty procedure with 400", async () => {
    const res = await POST(req({ procedure: "", code: "72148", clinics: [{ name: "x", phone: "+1512" }] }));
    expect(res.status).toBe(400);
  });

  it("rejects zero clinics with 400", async () => {
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 10 clinics with 400", async () => {
    const clinics = Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, phone: "+1512" }));
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics }));
    expect(res.status).toBe(400);
  });

  it("creates a mock rfq and returns mode:mock with zero network", async () => {
    const res = await POST(req({ procedure: "MRI lumbar spine", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.mode).toBe("mock");
    expect(json.data.rfq_id).toMatch(/^rfq_/);
  });
});

describe("POST /api/quotes — E.164 + dedupe (reviewer fix 1)", () => {
  it("rejects a clinic with an empty phone (400, names the entry)", async () => {
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Empty Phone Clinic", phone: "" }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Empty Phone Clinic");
  });

  it("rejects a clinic with a garbage phone (400)", async () => {
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Garbage", phone: "+1512" }] }));
    expect(res.status).toBe(400);
  });

  it("rejects duplicate recipient phones (400)", async () => {
    const res = await POST(
      req({
        procedure: "MRI",
        code: "72148",
        clinics: [
          { name: "A", phone: "+15125550142" },
          { name: "B", phone: "+15125550142" },
        ],
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    // Reviewer fix 3: validation errors must NOT leak the full E.164 — it is masked.
    expect(json.error).toContain("duplicate recipient phone: +1512•••0142");
    expect(json.error).not.toContain("+15125550142");
  });
});

describe("POST /api/quotes — caller authorization on live creation (reviewer fix 1)", () => {
  const TOKEN = "gf_live_token_123";
  beforeEach(() => {
    process.env.GOODFAITH_LIVE = "1";
    process.env.CALLE_API_KEY = "iams_test_key";
    process.env.GOODFAITH_ALLOWED_RECIPIENTS = "+15125550142";
  });

  it("rejects a live creation with no bearer token (401)", async () => {
    process.env.GOODFAITH_API_TOKEN = TOKEN;
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("caller authorization required");
  });

  it("rejects a live creation with a wrong bearer token (401)", async () => {
    process.env.GOODFAITH_API_TOKEN = TOKEN;
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }, undefined, "wrong"));
    expect(res.status).toBe(401);
  });

  it("fails closed with 401 when live but no server token is configured", async () => {
    delete process.env.GOODFAITH_API_TOKEN;
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }, undefined, "anything"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("not configured");
  });
});

describe("POST /api/quotes — live allowlist (reviewer fix 1)", () => {
  const TOKEN = "gf_live_token_123";
  beforeEach(() => {
    process.env.GOODFAITH_LIVE = "1";
    process.env.CALLE_API_KEY = "iams_test_key";
    process.env.GOODFAITH_API_TOKEN = TOKEN;
  });

  it("refuses live dialing with 403 when the allowlist is empty (authorized caller)", async () => {
    delete process.env.GOODFAITH_ALLOWED_RECIPIENTS;
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }, undefined, TOKEN));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("GOODFAITH_ALLOWED_RECIPIENTS");
  });

  it("returns 403 for a recipient not on a non-empty allowlist, masking the number (fix 3)", async () => {
    process.env.GOODFAITH_ALLOWED_RECIPIENTS = "+15125550188";
    const res = await POST(req({ procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] }, undefined, TOKEN));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("recipient not authorized for live calls: +1512•••0142");
    expect(json.error).not.toContain("+15125550142");
  });
});

describe("POST /api/quotes — rate limit (reviewer fix 1)", () => {
  it("returns 429 after 20 requests from the same IP in a window", async () => {
    const ip = "203.0.113.7";
    const body = { procedure: "MRI", code: "72148", clinics: [{ name: "Lone Star", phone: "+15125550142" }] };
    let last = 200;
    for (let i = 0; i < 21; i++) {
      const res = await POST(req(body, ip));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
