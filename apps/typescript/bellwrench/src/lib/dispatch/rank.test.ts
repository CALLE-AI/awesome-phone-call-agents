import { describe, expect, it } from "vitest";

import type { VendorCallResult } from "./types";
import { rankVendorResults } from "./rank";

const base: VendorCallResult = {
  vendorId: "vendor",
  vendorName: "Vendor",
  status: "verified",
  callId: "call-1",
  callStatus: "completed",
  recipientStatus: "completed",
  taskCompleted: true,
  availability: "available",
  earliestEta: "2026-08-05T09:00:00.000Z",
  priceType: "estimate",
  priceAmount: 150,
  currency: "USD",
  constraints: [],
  completionConfidence: "high",
  confidenceScore: 0.92,
  summary: "Available tomorrow.",
  evidence: ["Vendor stated the arrival window."],
  failureCode: null,
};

describe("rankVendorResults", () => {
  it("prioritizes verified vendors, then availability, ETA, and known price", () => {
    const results: VendorCallResult[] = [
      { ...base, vendorId: "failed", status: "failed", availability: "unknown" },
      { ...base, vendorId: "unknown", status: "unknown", availability: "unknown" },
      { ...base, vendorId: "incomplete", status: "incomplete" },
      {
        ...base,
        vendorId: "later",
        earliestEta: "2026-08-06T09:00:00.000Z",
        priceAmount: 90,
      },
      { ...base, vendorId: "best" },
      { ...base, vendorId: "unavailable", availability: "unavailable" },
    ];

    expect(rankVendorResults(results).map((result) => result.vendorId)).toEqual([
      "best",
      "later",
      "unavailable",
      "failed",
      "unknown",
      "incomplete",
    ]);
  });

  it("keeps non-verified outcomes in their original relative order", () => {
    const results: VendorCallResult[] = [
      { ...base, vendorId: "unknown", status: "unknown" },
      { ...base, vendorId: "failed", status: "failed" },
      { ...base, vendorId: "incomplete", status: "incomplete" },
    ];

    expect(rankVendorResults(results).map((result) => result.vendorId)).toEqual([
      "unknown",
      "failed",
      "incomplete",
    ]);
  });

  it("does not mutate the API result order", () => {
    const results = [
      { ...base, vendorId: "expensive", priceAmount: 300 },
      { ...base, vendorId: "affordable", priceAmount: 100 },
    ];

    rankVendorResults(results);

    expect(results.map((result) => result.vendorId)).toEqual(["expensive", "affordable"]);
  });
});

