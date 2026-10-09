import { describe, expect, it } from "vitest";

import type { DispatchRequest } from "./types";
import { validateDispatchRequest } from "./validation";

const validRequest: DispatchRequest = {
  workOrder: {
    title: "Slow bathroom drain",
    issue:
      "The bathroom sink is draining slowly and the tenant has another working sink.",
    property: "Juniper House",
    location: "Unit 4B",
    urgency: "soon",
    disclosure:
      "Share the property name, unit, issue description, and requested service window.",
    maximumAuthorizedAction: "information_only",
  },
  vendors: [
    {
      id: "vendor-1",
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

describe("validateDispatchRequest", () => {
  it("accepts a complete, authorized request", () => {
    expect(validateDispatchRequest(validRequest)).toEqual({ valid: true, errors: [] });
  });

  it("rejects unconfirmed execution, invalid phone numbers, and unauthorized vendors", () => {
    const result = validateDispatchRequest({
      ...validRequest,
      confirmedRealCalls: false,
      vendors: [
        {
          ...validRequest.vendors[0],
          phone: "415-555-0100",
          authorized: false,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        "confirmedRealCalls",
        "vendors.0.phone",
        "vendors.0.authorized",
      ]),
    );
  });

  it("rejects an empty selected roster and an invalid dispatch identity", () => {
    const result = validateDispatchRequest({
      ...validRequest,
      vendors: validRequest.vendors.map((vendor) => ({ ...vendor, selected: false })),
      dispatchId: "not-a-uuid",
    });

    expect(result.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(["vendors", "dispatchId"]),
    );
  });
});

