/**
 * Shared fixtures. Phone numbers come from the reserved 555-01xx range, so
 * nothing here can ring a real handset.
 */

import { parseRequest } from "../src/config.js";
import type { CoordinationRequest, CoordinationRequestInput } from "../src/types.js";

export const PLUMBER = "+14155550101";
export const TENANT = "+14155550100";
export const SUPER = "+14155550102";

export function requestInput(
  overrides: Partial<CoordinationRequestInput> = {},
): CoordinationRequestInput {
  return {
    request_id: "ash-lane-3b-leak",
    meeting: {
      purpose: "the plumbing repair at 14 Ash Lane, apartment 3B",
      location: "14 Ash Lane, apartment 3B",
      timezone: "America/Los_Angeles",
      organizer: "Ash Lane property management",
      duration_minutes: 90,
    },
    slots: [
      { id: "thu-10", start: "2026-08-06T10:00:00-07:00" },
      { id: "thu-14", start: "2026-08-06T14:00:00-07:00" },
      { id: "fri-09", start: "2026-08-07T09:00:00-07:00" },
    ],
    parties: [
      { id: "plumber", name: "Marcus Lee", phone: PLUMBER, role: "plumber", region: "US", locale: "en-US" },
      { id: "tenant", name: "Fatima Haddad", phone: TENANT, role: "tenant", region: "US", locale: "en-US" },
      {
        id: "superintendent",
        name: "Dana Alvarez",
        phone: SUPER,
        role: "building superintendent",
        region: "US",
        locale: "en-US",
      },
    ],
    ...overrides,
  };
}

export function coordinationRequest(
  overrides: Partial<CoordinationRequestInput> = {},
): CoordinationRequest {
  return parseRequest(requestInput(overrides));
}
