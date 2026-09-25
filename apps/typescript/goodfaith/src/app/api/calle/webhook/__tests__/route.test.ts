// File: src/app/api/calle/webhook/__tests__/route.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

function webhookReq(eventId: string | null, body: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (eventId) headers["CALL-E-Event-Id"] = eventId;
  return new NextRequest("http://localhost:3000/api/calle/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const envelope = {
  id: "ev_unique_1",
  type: "call.completed",
  created_at: "2026-09-14T08:06:12Z",
  data: { id: "call_x", recipients: [], metadata: { rfq_id: "rfq_demo_72148" } },
};

describe("POST /api/calle/webhook — idempotency (F-008)", () => {
  it("rejects a missing CALL-E-Event-Id with 400", async () => {
    const res = await POST(webhookReq(null, envelope));
    expect(res.status).toBe(400);
  });

  it("processes once, then dedupes a re-delivered event", async () => {
    const first = await POST(webhookReq("ev_dedupe_test", envelope));
    const firstJson = await first.json();
    expect(firstJson.ok).toBe(true);
    expect(firstJson.deduped).toBeUndefined();

    const second = await POST(webhookReq("ev_dedupe_test", envelope));
    const secondJson = await second.json();
    expect(secondJson.ok).toBe(true);
    expect(secondJson.deduped).toBe(true);
  });
});

describe("POST /api/calle/webhook — untrusted body not written in mock mode (reviewer fix 3)", () => {
  it("returns 202 and ignores body-supplied evidence in mock mode", async () => {
    delete process.env.GOODFAITH_LIVE;
    delete process.env.CALLE_API_KEY;
    const res = await POST(webhookReq("ev_mock_ignore_1", envelope));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.note).toContain("mock mode");
  });
});
