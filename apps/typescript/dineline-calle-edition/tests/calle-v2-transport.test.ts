import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovedBookingContract } from "../src/domain/booking-contract.js";
import { createPreferenceIntakeContract } from "../src/domain/dining-preferences.js";
import { createExecutionContext, createIntakeExecutionContext } from "../src/domain/execution-context.js";
import { CalleSdkProvider } from "../src/providers/calle/calle-sdk-provider.js";
import { CalleIntakeProvider } from "../src/providers/calle/calle-intake-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("DineLine n8n providers through the published SDK", () => {
  it.each(["booking", "intake"] as const)("uses Calls v2 for %s and waits past telephone completion", async (role) => {
    const requests: Array<{ method: string; path: string; key: string | null; body: unknown }> = [];
    const quote = role === "booking" ? "The reservation is confirmed for two." : "Italian in Manhattan for two, no peanuts.";
    const result = {
      task_completed: true, completion_confidence: 0.95, evidence: quote, summary: quote,
      ...(role === "booking" ? {
        outcome: "confirmed", confirmed_date: "2026-11-06", confirmed_time: "19:30", confirmed_party_size: 2,
        confirmation_code: "DEMO", alternative_date: "unknown", alternative_time: "unknown", notes: "Confirmed.",
      } : {
        location: "Manhattan", cuisine: "Italian", date: "2026-11-06", time: "19:30", time_zone: "America/New_York",
        party_size: 2, budget: "moderate", atmosphere: "quiet", dietary_needs: '["no peanuts"]', notes: "none",
      }),
    };
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ method: request.method, path, key: request.headers.get("Idempotency-Key"), body });
      if (request.method === "POST") {
        expect(path).toBe("/v2/calls");
        expect(body).toMatchObject({ phone: "+12025550143", region: "US", locale: "en-US" });
        expect(body).not.toHaveProperty("recipients");
        expect(body.result_schema.type).toBe("object");
        expect(body.result_schema.additionalProperties).toBe(false);
        expect(Object.keys(body.result_schema.properties).every((key) => /^[a-z][a-z0-9_]{0,63}$/.test(key))).toBe(true);
        for (const field of Object.values(body.result_schema.properties) as Array<{ type: string }>) {
          expect(["string", "number", "integer", "boolean"]).toContain(field.type);
        }
      } else {
        expect(path).toBe("/v2/calls/call_wire_contract");
        gets += 1;
      }
      const ready = gets >= 2;
      return Response.json({
        object: "call", id: "call_wire_contract", call_id: "billing_not_a_polling_id", status: "completed",
        call_outcome: "completed", result_status: ready ? "available" : "pending", result: ready ? result : null,
        transcript: ready ? [{ speaker: "callee", text: quote, offset_seconds: 1 }] : [], error: null,
        task: "Controlled fixture", phone: "+12025550143", region: "US", locale: "en-US", metadata: {},
        created_at: "2026-10-28T00:00:00Z", completed_at: "2026-10-28T00:00:01Z",
      }, { status: request.method === "POST" ? 202 : 200 });
    }));
    const options = { apiKey: "fixture-only", allowRealCalls: true, allowedPhoneNumbers: new Set(["+12025550143"]), timeoutMs: 8000 };
    let expectedKey: string;
    let output;
    if (role === "booking") {
      const contract = createApprovedBookingContract({
        restaurant: { name: "Fictional Kitchen", address: "100 Example Avenue", phone: "+12025550143" },
        reservation: { guestName: "Demo Guest", date: "2026-11-06", time: "19:30", timeZone: "America/New_York", partySize: 2, specialRequests: "" },
      });
      expectedKey = contract.idempotencyKey;
      output = await new CalleSdkProvider(options).execute(contract, expectedKey, createExecutionContext(contract.contractId));
    } else {
      const contract = createPreferenceIntakeContract({ phone: "+12025550143", sessionId: "wire-contract-intake", explicitConsent: true });
      expectedKey = contract.idempotencyKey;
      output = await new CalleIntakeProvider(options).execute(contract, expectedKey, createIntakeExecutionContext(contract.requestId));
    }
    expect(requests.map((r) => r.method)).toEqual(["POST", "GET", "GET"]);
    expect(requests[0]?.key).toBe(expectedKey);
    expect(output).toMatchObject({ providerCallId: "call_wire_contract", status: "completed", resultStatus: "available", taskCompleted: true, completionConfidence: { score: 0.95 }, evidence: [quote] });
    expect(output.transcript).toEqual([`callee: ${quote}`]);
  }, 10_000);
});
