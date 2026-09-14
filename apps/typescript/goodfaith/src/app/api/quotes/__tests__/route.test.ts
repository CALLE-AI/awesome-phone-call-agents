// File: src/app/api/quotes/__tests__/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // Ensure mock mode (no live), independent of the machine's env.
  delete process.env.GOODFAITH_LIVE;
  delete process.env.CALLE_API_KEY;
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
