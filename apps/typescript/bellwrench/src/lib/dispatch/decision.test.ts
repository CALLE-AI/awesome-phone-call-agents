import { describe, expect, it } from "vitest";

import { createDispatchDecision } from "./decision";
import type { VendorCallResult } from "./types";

const verified: VendorCallResult = {
  vendorId: "vendor-1",
  vendorName: "Northstar Plumbing",
  status: "verified",
  callId: "call-123",
  callStatus: "completed",
  recipientStatus: "completed",
  taskCompleted: true,
  availability: "available",
  earliestEta: "2026-09-14T14:00:00.000Z",
  priceType: "estimate",
  priceAmount: 180,
  currency: "USD",
  constraints: [],
  completionConfidence: "high",
  confidenceScore: 0.9,
  summary: "Available today.",
  evidence: ["Vendor stated availability."],
  failureCode: null,
};

describe("createDispatchDecision", () => {
  it("records a verified vendor without claiming a booking", () => {
    expect(
      createDispatchDecision({
        dispatchId: "0f71ab16-254f-4f7d-84c0-507cad4dfbd2",
        kind: "vendor_selected",
        vendorId: verified.vendorId,
        results: [verified],
        note: "Operator will contact the vendor to approve terms.",
        now: () => new Date("2026-09-14T12:00:00.000Z"),
      }),
    ).toEqual({
      dispatchId: "0f71ab16-254f-4f7d-84c0-507cad4dfbd2",
      kind: "vendor_selected",
      vendorId: "vendor-1",
      vendorName: "Northstar Plumbing",
      callId: "call-123",
      note: "Operator will contact the vendor to approve terms.",
      recordedAt: "2026-09-14T12:00:00.000Z",
      bookingStatus: "not_booked",
    });
  });

  it.each(["incomplete", "failed", "unknown"] as const)(
    "refuses to select a %s vendor outcome",
    (status) => {
      expect(() =>
        createDispatchDecision({
          dispatchId: "0f71ab16-254f-4f7d-84c0-507cad4dfbd2",
          kind: "vendor_selected",
          vendorId: verified.vendorId,
          results: [{ ...verified, status }],
        }),
      ).toThrow("Only a verified vendor result can be selected");
    },
  );

  it("records a no-dispatch decision without a vendor or call ID", () => {
    expect(
      createDispatchDecision({
        dispatchId: "0f71ab16-254f-4f7d-84c0-507cad4dfbd2",
        kind: "no_dispatch",
        results: [verified],
        now: () => new Date("2026-09-14T12:00:00.000Z"),
      }),
    ).toMatchObject({
      kind: "no_dispatch",
      vendorId: null,
      callId: null,
      bookingStatus: "not_booked",
    });
  });
});
