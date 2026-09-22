import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";

import { assertProviderCallContract, assertProviderEventPageContract } from "../../server/calle/provider-contract";
import { acceptCalleWebhook, resetWebhookReceiptLedger } from "../../server/calle/webhook";

afterEach(() => resetWebhookReceiptLedger());

describe("CALL-E final-submission safeguards", () => {
  it("accepts documented known provider status values and rejects unknown state", () => {
    expect(() => assertProviderCallContract({ id: "call_1", status: "queued", object: "call_task" })).not.toThrow();
    expect(() => assertProviderCallContract({ id: "call_1", status: "mystery" })).toThrow(/unknown status/i);
    expect(() => assertProviderCallContract({ id: "", status: "completed" })).toThrow(/missing id/i);
  });

  it("requires stable event identifiers and types in live provider event pages", () => {
    expect(() => assertProviderEventPageContract({
      object: "list",
      data: [{ id: "evt_1", type: "call.completed", call_id: "call_1", created_at: "2026-01-01T00:00:00.000Z" }],
      next_cursor: null,
    })).not.toThrow();
    expect(() => assertProviderEventPageContract({ object: "list", data: [{ id: "evt_1" }] })).toThrow(/missing type/i);
  });

  it("requires a configured HMAC secret and reports duplicate deliveries safely", () => {
    const secret = "webhook-test-secret";
    const body = JSON.stringify({
      id: "evt_1",
      type: "call.completed",
      data: { id: "call_1", status: "completed", recipients: [{ phones: ["+14165551234"] }] },
    });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    const first = acceptCalleWebhook(body, signature, secret);
    const second = acceptCalleWebhook(body, signature, secret);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(first.event.id).toBe("call_1");
    expect(first.receiptId).toHaveLength(16);
    expect(() => acceptCalleWebhook(body, signature, undefined)).toThrow(/signature/i);
    expect(() => acceptCalleWebhook(body, "sha256=deadbeef", secret)).toThrow(/signature/i);
  });
});
