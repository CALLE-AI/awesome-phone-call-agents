import { describe, expect, it } from "vitest";

import type { DispatchRequest, Vendor } from "./types";
import { providerIdempotencyKey } from "./identity";

const vendor: Vendor = {
  id: "vendor-1",
  name: "Northline Plumbing",
  trade: "Plumbing",
  phone: "+14155550100",
  authorized: true,
  selected: true,
};

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
  vendors: [vendor],
  confirmedRealCalls: true,
  dispatchId: "4f0ef7b0-3d25-4e6f-a0cd-2dd6cf2ebdd9",
};

describe("providerIdempotencyKey", () => {
  it("is stable, namespaced, and within the provider limit", () => {
    const first = providerIdempotencyKey(request, vendor);
    const second = providerIdempotencyKey(structuredClone(request), { ...vendor });

    expect(first).toBe(second);
    expect(first).toMatch(
      /^bellwrench:4f0ef7b0-3d25-4e6f-a0cd-2dd6cf2ebdd9:[a-f0-9]{32}$/,
    );
    expect(first.length).toBeLessThanOrEqual(120);
  });

  it.each([
    [
      "dispatch identity",
      {
        ...request,
        dispatchId: "d8d58659-8f72-46ca-912c-c20aa4723910",
      },
    ],
    [
      "recipient number",
      { ...request, vendors: [{ ...vendor, phone: "+14155550102" }] },
    ],
    [
      "call task",
      {
        ...request,
        workOrder: {
          ...request.workOrder,
          issue: "A different non-emergency leak description.",
        },
      },
    ],
  ])("changes when %s changes", (_label, changed) => {
    expect(providerIdempotencyKey(changed, changed.vendors[0])).not.toBe(
      providerIdempotencyKey(request, vendor),
    );
  });

  it("changes for another selected vendor in the same dispatch", () => {
    const secondVendor = {
      ...vendor,
      id: "vendor-2",
      name: "Copper & Co.",
      phone: "+14155550101",
    };

    expect(providerIdempotencyKey(request, secondVendor)).not.toBe(
      providerIdempotencyKey(request, vendor),
    );
  });
});
