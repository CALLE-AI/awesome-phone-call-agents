import type { Call, CreateCallInput } from "@call-e/calle";
import { describe, expect, it } from "vitest";

import type { CallPort } from "../calle/client";
import { executeDispatch } from "./execute";
import type { DispatchRequest } from "./types";

const request: DispatchRequest = {
  workOrder: {
    title: "Slow bathroom drain",
    issue: "The bathroom sink is draining slowly and another sink is available.",
    property: "Juniper House",
    location: "Unit 4B",
    urgency: "soon",
    disclosure: "Share the property, unit, issue, and requested service window.",
    maximumAuthorizedAction: "information_only",
  },
  vendors: [
    {
      id: "vendor-a",
      name: "Northline Plumbing",
      trade: "Plumbing",
      phone: "+14155550100",
      authorized: true,
      selected: true,
    },
    {
      id: "vendor-b",
      name: "Copper & Co.",
      trade: "Plumbing",
      phone: "+14155550101",
      authorized: true,
      selected: true,
    },
  ],
  confirmedRealCalls: true,
  dispatchId: "4f0ef7b0-3d25-4e6f-a0cd-2dd6cf2ebdd9",
};

const structuredResult = {
  availability: "available",
  earliest_eta: "2026-08-05T09:00:00.000Z",
  price_type: "estimate",
  price_amount: "150",
  currency: "USD",
  constraints: ["Needs access to the unit"],
};

function call(
  id: string,
  overrides: Partial<Call> = {},
): Call {
  return {
    id,
    object: "call_task",
    status: "completed",
    task: "Ask for availability.",
    recipients: [
      {
        id: `recipient-${id}`,
        phones: ["+14155550100"],
        locale: null,
        region: null,
        status: "completed",
        structuredResult,
        summary: "Available tomorrow.",
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: "Vendor can attend tomorrow morning.",
    taskCompleted: true,
    completionConfidence: { score: 0.92, label: "high" },
    evidence: ["Vendor stated a 9 AM arrival."],
    metadata: { workflow: "bellwrench_dispatch" },
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-08-04T22:00:00.000Z",
    completedAt: "2026-08-04T22:01:00.000Z",
    ...overrides,
  };
}

function port(input: {
  create?: CallPort["create"];
  waitForResult?: CallPort["waitForResult"];
} = {}): CallPort {
  return {
    create:
      input.create ??
      (async (callInput: CreateCallInput) =>
        call(
          callInput.recipient?.phone === "+14155550101"
            ? "call-vendor-b"
            : "call-vendor-a",
          { status: "queued", taskCompleted: null, completedAt: null },
        )),
    waitForResult:
      input.waitForResult ??
      (async (callId: string) => call(callId)),
  };
}

const noDelay = { reconciliationSleep: async () => undefined };

describe("executeDispatch", () => {
  it("preserves verified evidence when another create is definitely rejected", async () => {
    const results = await executeDispatch(
      request,
      port({
        create: async (input) => {
          if (input.recipient?.phone === "+14155550101") {
            throw Object.assign(new Error("private provider detail"), {
              status: 400,
              code: "invalid_recipient",
            });
          }
          return call("call-vendor-a", {
            status: "queued",
            taskCompleted: null,
            completedAt: null,
          });
        },
      }),
      noDelay,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      vendorId: "vendor-a",
      status: "verified",
      callId: "call-vendor-a",
      availability: "available",
      priceAmount: 150,
    });
    expect(results[1]).toMatchObject({
      vendorId: "vendor-b",
      status: "failed",
      callId: null,
      failureCode: "invalid_recipient",
    });
    expect(JSON.stringify(results)).not.toContain("private provider detail");
  });

  it.each(["failed", "canceled"] as const)(
    "does not verify a resolved %s call",
    async (status) => {
      const [result] = await executeDispatch(
        { ...request, vendors: [request.vendors[0]] },
        port({
          waitForResult: async (callId) =>
            call(callId, {
              status,
              taskCompleted: false,
              failureCode: "no_answer",
              failureMessage: "raw provider message",
            }),
        }),
        noDelay,
      );

      expect(result).toMatchObject({
        status: "failed",
        callStatus: status,
        failureCode: "no_answer",
      });
      expect(JSON.stringify(result)).not.toContain("raw provider message");
    },
  );

  it("returns unknown without a call ID when create reconciliation exhausts", async () => {
    const keys: string[] = [];
    const [result] = await executeDispatch(
      { ...request, vendors: [request.vendors[0]] },
      port({
        create: async (_input, options) => {
          keys.push(options.idempotencyKey);
          throw new TypeError("connection reset for +14155550100");
        },
      }),
      noDelay,
    );

    expect(result).toMatchObject({
      status: "unknown",
      callId: null,
      failureCode: "CREATE_OUTCOME_UNRESOLVED",
    });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(JSON.stringify(result)).not.toContain("+14155550100");
  });

  it("preserves a known call ID when result polling fails", async () => {
    const [result] = await executeDispatch(
      { ...request, vendors: [request.vendors[0]] },
      port({
        waitForResult: async () => {
          throw new TypeError("polling failed with private detail");
        },
      }),
      noDelay,
    );

    expect(result).toMatchObject({
      status: "unknown",
      callId: "call-vendor-a",
      failureCode: "RESULT_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });

  it("marks a completed call with incomplete recipient output as incomplete", async () => {
    const [result] = await executeDispatch(
      { ...request, vendors: [request.vendors[0]] },
      port({
        waitForResult: async (callId) =>
          call(callId, {
            recipients: [
              {
                ...call(callId).recipients[0],
                status: "failed",
              },
            ],
          }),
      }),
      noDelay,
    );

    expect(result).toMatchObject({
      status: "incomplete",
      callId: "call-vendor-a",
      recipientStatus: "failed",
      failureCode: "RESULT_INCOMPLETE",
    });
  });
});
