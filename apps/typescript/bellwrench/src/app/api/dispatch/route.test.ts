import type { Call } from "@call-e/calle";
import { describe, expect, it } from "vitest";

import type { CallPort } from "@/lib/calle/client";
import type { DispatchRequest } from "@/lib/dispatch/types";
import { handleDispatch } from "./controller";

const validRequest: DispatchRequest = {
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
  ],
  confirmedRealCalls: true,
  dispatchId: "4f0ef7b0-3d25-4e6f-a0cd-2dd6cf2ebdd9",
};

function terminalCall(
  id: string,
  status: "completed" | "failed" | "canceled" = "completed",
): Call {
  const completed = status === "completed";
  return {
    id,
    object: "call_task",
    status,
    task: "Ask for availability.",
    recipients: [
      {
        id: `recipient-${id}`,
        phones: ["+14155550100"],
        locale: null,
        region: null,
        status: completed ? "completed" : "failed",
        structuredResult: completed
          ? {
              availability: "available",
              earliest_eta: null,
              price_type: "quote_required",
              price_amount: null,
              currency: null,
              constraints: [],
            }
          : null,
        summary: completed ? "Available." : null,
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: completed ? "Available." : null,
    taskCompleted: completed,
    completionConfidence: completed ? { score: 0.91, label: "high" } : null,
    evidence: completed ? ["Vendor confirmed availability."] : [],
    metadata: { workflow: "bellwrench_dispatch" },
    failureCode: completed ? null : "no_answer",
    failureMessage: completed ? null : "raw failure",
    createdAt: "2026-08-04T22:00:00.000Z",
    completedAt: "2026-08-04T22:01:00.000Z",
  };
}

function portFor(statuses: Record<string, "completed" | "failed" | "unknown">): CallPort {
  return {
    create: async (input) => {
      const id = input.recipient?.phone === "+14155550101" ? "call-b" : "call-a";
      return terminalCall(id);
    },
    waitForResult: async (id) => {
      if (statuses[id] === "unknown") throw new TypeError("poll interrupted");
      return terminalCall(id, statuses[id] ?? "completed");
    },
  };
}

describe("handleDispatch", () => {
  it("rejects malformed JSON-shaped input", async () => {
    const response = await handleDispatch({ hello: "world" }, { apiKey: "key" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
  });

  it("refuses an emergency before creating a CALL-E client", async () => {
    let created = false;
    const response = await handleDispatch(
      {
        ...validRequest,
        workOrder: { ...validRequest.workOrder, issue: "Smoke is filling the hallway" },
      },
      {
        apiKey: "key",
        createPort: () => {
          created = true;
          throw new Error("must not run");
        },
      },
    );

    expect(response.status).toBe(422);
    expect(created).toBe(false);
    await expect(response.json()).resolves.toMatchObject({ code: "emergency_refused" });
  });

  it("returns configuration_required when the server API key is absent", async () => {
    const response = await handleDispatch(validRequest, { apiKey: undefined });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "configuration_required" });
  });

  it("rejects a request that has not explicitly confirmed real calls", async () => {
    const response = await handleDispatch(
      { ...validRequest, confirmedRealCalls: false },
      { apiKey: "key" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "validation_failed" });
  });

  it("returns partial status without erasing successful evidence", async () => {
    const request = {
      ...validRequest,
      vendors: [
        validRequest.vendors[0],
        {
          ...validRequest.vendors[0],
          id: "vendor-b",
          name: "Copper & Co.",
          phone: "+14155550101",
        },
      ],
    };
    const response = await handleDispatch(request, {
      apiKey: "key",
      createPort: () => portFor({ "call-a": "completed", "call-b": "failed" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.results).toHaveLength(2);
    expect(body.results.map((result: { status: string }) => result.status)).toEqual([
      "verified",
      "failed",
    ]);
  });

  it("returns unresolved when no evidence is verified and a known call is uncertain", async () => {
    const response = await handleDispatch(validRequest, {
      apiKey: "key",
      createPort: () => portFor({ "call-a": "unknown" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "unresolved",
      results: [
        {
          status: "unknown",
          callId: "call-a",
          failureCode: "RESULT_UNAVAILABLE",
        },
      ],
    });
  });

  it("returns failed only when every vendor outcome is definitively failed", async () => {
    const response = await handleDispatch(validRequest, {
      apiKey: "key",
      createPort: () => portFor({ "call-a": "failed" }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      results: [{ status: "failed", failureCode: "no_answer" }],
    });
  });
});
