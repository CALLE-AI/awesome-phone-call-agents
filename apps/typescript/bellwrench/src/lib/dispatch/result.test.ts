import { describe, expect, it } from "vitest";

import {
  classifyTerminalCall,
  parseVendorStructuredResult,
} from "./result";

const validStructuredResult = {
  availability: "available",
  earliest_eta: "2026-08-05T09:00:00.000Z",
  price_type: "estimate",
  price_amount: 150,
  currency: "USD",
  constraints: ["Needs access to the unit"],
};

const validTerminalCall = {
  vendorId: "vendor-a",
  vendorName: "Northline Plumbing",
  callId: "call-live-1",
  status: "completed",
  taskCompleted: true,
  completionConfidence: { score: 0.92, label: "high" },
  summary: "Vendor can attend tomorrow morning.",
  evidence: ["Vendor stated a 9 AM arrival."],
  failureCode: null,
  recipientStatus: "completed",
  structuredResult: validStructuredResult,
};

describe("parseVendorStructuredResult", () => {
  it("accepts a complete quote-required result", () => {
    expect(
      parseVendorStructuredResult({
        ...validStructuredResult,
        price_type: "quote_required",
        price_amount: null,
        currency: null,
      }),
    ).toEqual({
      availability: "available",
      earliestEta: "2026-08-05T09:00:00.000Z",
      priceType: "quote_required",
      priceAmount: null,
      currency: null,
      constraints: ["Needs access to the unit"],
    });
  });

  it.each([
    ["invalid availability", { availability: "maybe" }],
    ["invalid ETA", { earliest_eta: "tomorrow-ish" }],
    ["negative price", { price_amount: -1 }],
    ["missing currency", { currency: null }],
    ["unexpected currency", { price_type: "quote_required", price_amount: null }],
    ["invalid constraint", { constraints: ["valid", 7] }],
    ["extra field", { internal_note: "do not expose" }],
  ])("rejects %s", (_label, patch) => {
    expect(
      parseVendorStructuredResult({ ...validStructuredResult, ...patch }),
    ).toBeNull();
  });
});

describe("classifyTerminalCall", () => {
  it("verifies only a completed, schema-valid, evidenced result", () => {
    expect(classifyTerminalCall(validTerminalCall)).toMatchObject({
      status: "verified",
      callStatus: "completed",
      recipientStatus: "completed",
      completionConfidence: "high",
      confidenceScore: 0.92,
      availability: "available",
      failureCode: null,
    });
  });

  it.each(["failed", "canceled"])(
    "maps a terminal %s call to failed",
    (status) => {
      expect(
        classifyTerminalCall({
          ...validTerminalCall,
          status,
          taskCompleted: false,
          failureCode: "no_answer",
        }),
      ).toMatchObject({
        status: "failed",
        callStatus: status,
        availability: "unknown",
        failureCode: "no_answer",
      });
    },
  );

  it.each([
    ["task incomplete", { taskCompleted: false }],
    ["recipient incomplete", { recipientStatus: "failed" }],
    ["confidence missing", { completionConfidence: null }],
    ["confidence low", { completionConfidence: { score: 0.49, label: "low" } }],
    ["schema malformed", { structuredResult: { broken: true } }],
    ["evidence missing", { evidence: [] }],
  ])("keeps %s output incomplete", (_label, patch) => {
    expect(
      classifyTerminalCall({ ...validTerminalCall, ...patch }),
    ).toMatchObject({ status: "incomplete", failureCode: "RESULT_INCOMPLETE" });
  });

  it("does not return unsafe failure or provider text", () => {
    const result = classifyTerminalCall({
      ...validTerminalCall,
      status: "failed",
      taskCompleted: false,
      failureCode: "failed for +14155550123: secret",
      summary: "Call to +14155550123 exposed a secret",
      evidence: ["private provider detail"],
    });

    expect(result.failureCode).toBe("CALL_NOT_COMPLETED");
    expect(result.summary).toBeNull();
    expect(result.evidence).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("+14155550123");
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });
});
