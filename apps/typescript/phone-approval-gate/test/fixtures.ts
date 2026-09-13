/**
 * Shared fixtures. Phone numbers come from the reserved 555-01xx range that is
 * kept aside for examples, so nothing here can ring a real handset.
 */

import { parseRequest } from "../src/config.js";
import type { ApprovalRequest, ApprovalRequestInput } from "../src/types.js";

export const ALICE_PHONE = "+14155550100";
export const BOB_PHONE = "+14155550101";
export const CAROL_PHONE = "+14155550102";

export function requestInput(overrides: Partial<ApprovalRequestInput> = {}): ApprovalRequestInput {
  return {
    request_id: "deploy-1842",
    organization: "Acme Payments",
    system: "github-actions",
    change: {
      title: "Deploy checkout-api 1.14.2 to production",
      summary: "Adds a retry on the payment webhook. Rollback is one revert.",
      environment: "production",
      requested_by: "workflow run 1842",
      links: ["https://example.com/runs/1842"],
    },
    approvers: [
      {
        id: "alice",
        name: "Alice",
        phone: ALICE_PHONE,
        region: "US",
        locale: "en-US",
        enrolled_at: "2026-07-01",
        authorized_for: ["production", "staging"],
      },
    ],
    ...overrides,
  };
}

export function approvalRequest(overrides: Partial<ApprovalRequestInput> = {}): ApprovalRequest {
  return parseRequest(requestInput(overrides));
}

export const FIXED_SECRET = { code: "472913", phrase: ["anchor", "cobalt", "meadow"] };
