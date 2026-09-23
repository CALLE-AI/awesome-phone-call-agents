import { describe, expect, it } from "vitest";

import { CalleAuthError, CalleRemoteError, CalleTimeoutError, CalleValidationError } from "../server/calle/errors";
import { unwrapCalleCall, unwrapCalleEventPage } from "../server/calle/http";
import { getMockCall, mockCall, resetMockCalls, selectMockScenario } from "../server/calle/mock";
import { isMockFallbackEligible, withMockFallback } from "../server/calle/mock-fallback";
import { normalizeStructuredResult } from "../server/calle/normalize-result";
import { FallbackCalleProvider } from "../server/calle-v4/fallback-provider";
import { DemoCalleProvider } from "../server/calle-v4/demo-provider";
import type { CalleCall, CreateCallInput, Provider } from "../server/calle-v4/types";

class FailingProvider implements Provider {
  constructor(private readonly error: Error) {}
  async createCall(): Promise<CalleCall> {
    throw this.error;
  }
  async getCall(): Promise<CalleCall> {
    throw this.error;
  }
  async getEvents(): Promise<{ events: never[] }> {
    throw this.error;
  }
}

describe("CALL-E mock fixtures", () => {
  it("persists created mock calls for later GET", () => {
    resetMockCalls();
    const created = mockCall({
      task: "Confirm a family check-in",
      recipients: [{ phones: ["+14165550123"], region: "CA" }],
      idempotencyKey: "mock-persist-123456",
    });
    expect(created.id).toMatch(/^call_mock_/);
    expect(getMockCall(created.id).task).toBe("Confirm a family check-in");
    expect(getMockCall(created.id).id).toBe(created.id);
  });

  it("returns structured results the care workflow can parse", () => {
    resetMockCalls();
    const created = mockCall({
      task: "Confirm a family check-in",
      recipients: [{ phones: ["+14165550123"], region: "CA" }],
      idempotencyKey: "mock-schema-123456",
    });
    const normalized = normalizeStructuredResult(created.structured_result);
    expect(normalized?.reached).toBe(true);
    expect(normalized?.summaryCode).toBe("ok_routine");
  });

  it("selects no-answer and busy fixtures from the task text", () => {
    expect(selectMockScenario("Call and record a no-answer")).toBe("no_answer");
    expect(selectMockScenario("The line is busy")).toBe("busy");
    expect(selectMockScenario("Leave a voicemail")).toBe("voicemail");
    expect(selectMockScenario("Escalate with the safety script")).toBe("safety_escalation");
  });
});

describe("CALL-E response unwrapping", () => {
  it("unwraps { data: call_task } envelopes from the official API", () => {
    const call = unwrapCalleCall({
      data: { id: "call_abc", object: "call_task", status: "queued", task: "x" },
    });
    expect(call.id).toBe("call_abc");
    expect(call.status).toBe("queued");
  });

  it("normalizes both data[] and events[] event pages", () => {
    expect(unwrapCalleEventPage({ data: [{ id: "e1" }] }).data).toHaveLength(1);
    expect(unwrapCalleEventPage({ events: [{ id: "e2" }] }).data[0]?.id).toBe("e2");
  });
});

describe("CALL-E mock fallback policy", () => {
  it("falls back on timeouts, auth, and 5xx but not validation errors", () => {
    expect(isMockFallbackEligible(new CalleTimeoutError())).toBe(true);
    expect(isMockFallbackEligible(new CalleAuthError())).toBe(true);
    expect(isMockFallbackEligible(new CalleRemoteError("down", 502))).toBe(true);
    expect(isMockFallbackEligible(new CalleRemoteError("missing", 404))).toBe(true);
    expect(isMockFallbackEligible(new CalleRemoteError("bad", 400))).toBe(false);
    expect(isMockFallbackEligible(new CalleValidationError("no"))).toBe(false);
    expect(isMockFallbackEligible(new TypeError("fetch failed"))).toBe(true);
    expect(isMockFallbackEligible(new CalleTimeoutError(), false)).toBe(false);
  });

  it("returns tagged mock data when live transport fails", async () => {
    resetMockCalls();
    const call = await withMockFallback(
      async () => {
        throw new CalleAuthError();
      },
      () =>
        mockCall(
          {
            task: "Confirm a family check-in",
            recipients: [{ phones: ["+14165550123"], region: "CA" }],
            idempotencyKey: "mock-fallback-live-123456",
          },
          "unauthorized",
        ),
    );
    expect(call.id).toMatch(/^call_mock_/);
    expect(call.status).toBe("completed");
    expect(call.metadata?.calle_source).toBe("mock_fallback");
    expect(call.metadata?.calle_fallback_reason).toBe("unauthorized");
    expect(getMockCall(call.id).id).toBe(call.id);
  });
});

describe("CALL-E v4 fallback provider", () => {
  it("uses demo fixtures when the live provider throws a transport error", async () => {
    const provider = new FallbackCalleProvider(
      new FailingProvider(Object.assign(new Error("CALL-E 503"), { status: 503 })),
      new DemoCalleProvider(),
    );
    const input: CreateCallInput = {
      task: "Call an authorized test recipient and confirm availability.",
      recipients: [{ phones: ["+15555550123"] }],
      idempotencyKey: "v4-fallback-12345678",
      metadata: { consent: "true", region: "US" },
    };
    const created = await provider.createCall(input);
    expect(created.status).toBe("queued");
    expect(created.metadata.calle_source).toBe("mock_fallback");
  });
});
