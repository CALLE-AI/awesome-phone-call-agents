// File: src/app/api/calle/webhook/__tests__/binding.test.ts
// Reviewer fix 2: a webhook can only ever refresh the RFQ that OWNS the posted call id.
// A forged body.data.metadata.rfq_id must NOT let call A's evidence overwrite RFQ B.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the CALL-E adapter so the live-binding path runs with no network. getCall returns the
// AUTHORITATIVE task for whatever call id it is handed; isLive() is forced true.
vi.mock("@/lib/calle", () => ({
  isLive: () => true,
  getCall: async (callId: string) => ({
    id: callId,
    status: "completed",
    structured_result: null,
    task_completed: true,
    recipients: [],
    summary: `AUTHORITATIVE:${callId}`,
    metadata: { rfq_id: callId === "call_A" ? "rfq_72148_aaaaaaaa" : "rfq_72148_bbbbbbbb" },
  }),
}));

import { POST } from "../route";
import { putRfq, getRfq } from "@/lib/store";

function webhookReq(eventId: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/calle/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": eventId },
    body: JSON.stringify(body),
  });
}

function seedRfq(rfqId: string, callId: string) {
  putRfq({
    rfqId,
    callId,
    mode: "live",
    procedure: "MRI",
    code: "72148",
    clinics: [{ name: "Clinic", phone: "+15125550142" }],
    task: null,
    createdAt: "2026-09-14T08:00:00Z",
  });
}

describe("POST /api/calle/webhook — call->rfq binding (reviewer fix 2)", () => {
  beforeEach(() => {
    seedRfq("rfq_72148_aaaaaaaa", "call_A");
    seedRfq("rfq_72148_bbbbbbbb", "call_B");
  });

  it("refreshes ONLY the RFQ that owns the posted call id (forged metadata.rfq_id ignored)", async () => {
    // Attacker posts call A's real id but claims it belongs to RFQ B.
    const forged = { data: { id: "call_A", metadata: { rfq_id: "rfq_72148_bbbbbbbb" } } };
    const res = await POST(webhookReq("ev_bind_1", forged));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // RFQ A (the true owner of call_A) is refreshed with call_A's authoritative evidence.
    expect(getRfq("rfq_72148_aaaaaaaa")?.task?.summary).toBe("AUTHORITATIVE:call_A");
    // RFQ B is UNTOUCHED — the forged metadata did not steer A's evidence onto B.
    expect(getRfq("rfq_72148_bbbbbbbb")?.task).toBeNull();
  });

  it("ignores a webhook for a call id with no stored RFQ", async () => {
    const res = await POST(webhookReq("ev_bind_2", { data: { id: "call_unknown" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.note).toContain("no matching rfq");
    expect(getRfq("rfq_72148_aaaaaaaa")?.task).toBeNull();
    expect(getRfq("rfq_72148_bbbbbbbb")?.task).toBeNull();
  });
});
