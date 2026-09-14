import { describe, expect, it } from "vitest";

import type { DispatchRequest, VendorCallResult } from "./types";
import {
  clearPendingIntent,
  loadPendingIntent,
  PENDING_DISPATCH_KEY,
  savePendingIntent,
  type StorageLike,
} from "./pending-intent";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

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
  ],
  confirmedRealCalls: true,
  dispatchId: "4f0ef7b0-3d25-4e6f-a0cd-2dd6cf2ebdd9",
};

const verifiedResult: VendorCallResult = {
  vendorId: "vendor-a",
  vendorName: "Northline Plumbing",
  status: "verified",
  callId: "call-live-1",
  callStatus: "completed",
  recipientStatus: "completed",
  taskCompleted: true,
  availability: "available",
  earliestEta: "2026-08-05T09:00:00.000Z",
  priceType: "estimate",
  priceAmount: 150,
  currency: "USD",
  constraints: ["Needs access to the unit"],
  completionConfidence: "high",
  confidenceScore: 0.92,
  summary: "Vendor can attend tomorrow morning.",
  evidence: ["Vendor stated a 9 AM arrival."],
  failureCode: null,
};

describe("pending dispatch intent", () => {
  it("round-trips a preview with execution confirmation reset", () => {
    const storage = memoryStorage();
    savePendingIntent(storage, {
      version: 1,
      phase: "preview",
      request,
      response: null,
    });

    expect(loadPendingIntent(storage)).toEqual({
      version: 1,
      phase: "preview",
      request: { ...request, confirmedRealCalls: false },
      response: null,
    });
  });

  it("round-trips a safe review response without restoring confirmation", () => {
    const storage = memoryStorage();
    savePendingIntent(storage, {
      version: 1,
      phase: "review",
      request,
      response: {
        status: "completed",
        message: "Verified evidence is ready for human review.",
        results: [verifiedResult],
      },
    });

    expect(loadPendingIntent(storage)).toMatchObject({
      phase: "review",
      request: { confirmedRealCalls: false },
      response: { results: [{ status: "verified", callId: "call-live-1" }] },
    });
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2 }),
    JSON.stringify({ version: 1, phase: "review", request: {} }),
    JSON.stringify({
      version: 1,
      phase: "review",
      request,
      response: { status: "completed", message: "ok", results: [{ status: "invented" }] },
    }),
  ])("rejects corrupt or unsupported state", (raw) => {
    const storage = memoryStorage();
    storage.setItem(PENDING_DISPATCH_KEY, raw);

    expect(loadPendingIntent(storage)).toBeNull();
  });

  it("clears the active intent", () => {
    const storage = memoryStorage();
    savePendingIntent(storage, {
      version: 1,
      phase: "preview",
      request,
      response: null,
    });

    clearPendingIntent(storage);

    expect(storage.getItem(PENDING_DISPATCH_KEY)).toBeNull();
  });
});
