/**
 * Shared fixtures. Every number is from the reserved 555-01xx range that is kept
 * aside for examples, so nothing here can ring a real handset.
 */

import { parseClaim } from "../src/config.js";
import type { Claim, ClaimInput } from "../src/types.js";

/** The number printed on the customer's card. The only number this app dials. */
export const TRUSTED = "+14155550100";
/** The number the message came from. Never dialled. */
export const SHOWN = "+14155550188";

export function claimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim_id: "northgate-voicemail-0912",
    customer: { name: "Dana Whitfield" },
    contact: {
      claimed_to_be: "Northgate Credit Union",
      channel: "voicemail",
      arrived_at: "2026-07-31T09:12:00-07:00",
      claimed_about: "a card that had been blocked",
      number_shown: SHOWN,
      asked_for: "ring back and read out the card number to unblock the card",
    },
    trusted_number: {
      phone: TRUSTED,
      printed_on: "the back of the debit card",
      region: "US",
    },
    policy: {
      per_call_timeout_seconds: 240,
      recent_window_minutes: 60,
      language: "en-US",
      min_confidence: 0.5,
    },
    ...overrides,
  };
}

export function claim(overrides: Partial<ClaimInput> = {}): Claim {
  return parseClaim(claimInput(overrides));
}

/** A claim with one field of `contact` replaced, which is where most refusals live. */
export function withContact(overrides: Partial<ClaimInput["contact"]>): ClaimInput {
  return claimInput({ contact: { ...claimInput().contact, ...overrides } });
}
