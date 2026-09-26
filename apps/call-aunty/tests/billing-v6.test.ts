/**
 * V6 monetization regression tests — domain, entitlements, ledger, mock billing.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { resetAuditLedger } from "../server/billing/audit-ledger";
import { resetMockBillingProvider } from "../server/billing/billing-provider";
import {
  getCallCreditBalance,
  grantCallCredits,
  resetCallCreditLedger,
  reserveCallCredits,
} from "../server/billing/call-credit-ledger";
import { ALWAYS_FREE_FEATURES } from "../server/billing/ethical-policy";
import { isEntitled, requireEntitlement } from "../server/billing/feature-gate";
import { createBillingService } from "../server/billing/service";
import { resetBillingStore, setSubscription } from "../server/billing/store";
import { newSubscriptionRecord } from "../server/billing/entitlements";
import { resetRevenueEvents, listRevenueEvents } from "../server/billing/revenue-events";
import { resetUsageMeters } from "../server/billing/usage-meters";
import { canTransitionSubscription } from "../server/billing/subscription-lifecycle";
import { getPlanById } from "../server/billing/catalog";

function resetAll() {
  resetBillingStore();
  resetCallCreditLedger();
  resetUsageMeters();
  resetRevenueEvents();
  resetAuditLedger();
  resetMockBillingProvider();
}

describe("V6 billing catalog", () => {
  it("includes free community tier with always-free features", () => {
    const free = getPlanById("community_free");
    expect(free).toBeTruthy();
    for (const f of ALWAYS_FREE_FEATURES) {
      expect(free!.features).toContain(f);
    }
  });

  it("marks organization plan as coming soon", () => {
    const org = getPlanById("organization_ngo");
    expect(org?.comingSoon).toBe(true);
    expect(org?.billable).toBe(false);
  });
});

describe("V6 entitlements", () => {
  beforeEach(resetAll);

  it("defaults to community free plan", () => {
    const billing = createBillingService();
    const ent = billing.getEntitlements(42);
    expect(ent.planId).toBe("community_free");
    expect(ent.features).toContain("core_safety_triage");
  });

  it("grants paid features after mock purchase", async () => {
    const billing = createBillingService();
    await billing.startPurchase(7, "professional_chw");
    const verified = await billing.verifyPurchase(
      7,
      "professional_chw",
      "mock_receipt_test_001",
    );
    expect(verified.ok).toBe(true);
    const ent = billing.getEntitlements(7);
    expect(ent.features).toContain("call_credits_live");
    expect(getCallCreditBalance(7)).toBeGreaterThan(0);
  });

  it("never denies always-free features", () => {
    const ctx = { userId: 1, subscription: null, org: null, demoMode: false };
    for (const f of ALWAYS_FREE_FEATURES) {
      expect(isEntitled(ctx, f)).toBe(true);
    }
  });

  it("requireEntitlement blocks paid feature on free plan", () => {
    const ctx = { userId: 1, subscription: null, org: null, demoMode: false };
    const gate = requireEntitlement(ctx, "export_reports");
    expect(gate.ok).toBe(false);
  });
});

describe("V6 call credit ledger", () => {
  beforeEach(resetAll);

  it("reserves and consumes credits idempotently", () => {
    grantCallCredits({ userId: 5, amount: 3, idempotencyKey: "grant-1" });
    const r1 = reserveCallCredits({
      userId: 5,
      workflowId: "wf1",
      idempotencyKey: "res-1",
    });
    expect(r1.ok).toBe(true);
    const r2 = reserveCallCredits({
      userId: 5,
      workflowId: "wf1",
      idempotencyKey: "res-1",
    });
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.reservation.reservationId).toBe(r2.reservation.reservationId);
    }
  });

  it("fails closed when insufficient credits for live call", () => {
    const billing = createBillingService();
    setSubscription(
      newSubscriptionRecord({ userId: 9, planId: "professional_chw", provider: "mock" }),
    );
    const result = billing.validateLiveCallBudget(9, { dryRun: false, workflowId: "live-wf" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient_call_credits");
  });

  it("allows dry-run without credits", () => {
    const billing = createBillingService();
    const result = billing.validateLiveCallBudget(9, { dryRun: true, workflowId: "dry-wf" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dryRun).toBe(true);
  });
});

describe("V6 subscription lifecycle", () => {
  it("allows trial to active transition", () => {
    expect(canTransitionSubscription("trialing", "active")).toBe(true);
  });

  it("blocks active to expired without cancel", () => {
    expect(canTransitionSubscription("active", "expired")).toBe(false);
  });
});

describe("V6 revenue events", () => {
  beforeEach(resetAll);

  it("records pricing funnel without PII fields", async () => {
    const billing = createBillingService();
    billing.recordPricingViewed(3);
    await billing.startPurchase(3, "professional_chw");
    const events = listRevenueEvents(3);
    expect(events.some((e) => e.eventType === "pricing_viewed")).toBe(true);
    expect(events.some((e) => e.eventType === "purchase_started")).toBe(true);
    for (const e of events) {
      expect(JSON.stringify(e.meta)).not.toMatch(/womanId|phone|transcript/);
    }
  });
});

describe("V6 plan advisor", () => {
  it("returns catalog-backed facts only", () => {
    const billing = createBillingService();
    const explained = billing.explainPlan("professional_chw", "en");
    expect(explained.ok).toBe(true);
    if (explained.ok) {
      expect(explained.source).toBe("rule_based_catalog");
      expect(explained.bullets.join(" ")).toContain("call credits");
    }
  });
});

describe("V6 error handling", () => {
  beforeEach(resetAll);

  it("returns billing_unavailable when provider throws", async () => {
    const billing = createBillingService({
      provider: {
        provider: "mock",
        startPurchase: async () => {
          throw new Error("network down");
        },
        verifyPurchase: async () => ({ ok: false as const, code: "verification_failed" as const }),
        restorePurchases: async () => [],
      },
    });
    const result = await billing.startPurchase(1, "professional_chw");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("billing_unavailable");
  });

  it("restorePurchases returns structured error on provider failure", async () => {
    const billing = createBillingService({
      provider: {
        provider: "mock",
        startPurchase: async () => ({
          ok: true as const,
          pendingSubscriptionId: "x",
          provider: "mock" as const,
          synthetic: true,
        }),
        verifyPurchase: async () => ({ ok: false as const, code: "verification_failed" as const }),
        restorePurchases: async () => {
          throw new Error("restore failed");
        },
      },
    });
    const result = await billing.restorePurchases(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("billing_unavailable");
  });

  it("finalizeCallBilling never throws", () => {
    const billing = createBillingService();
    expect(() =>
      billing.finalizeCallBilling({
        userId: NaN as unknown as number,
        workflowId: "bad",
        status: "failed",
        dryRun: false,
      }),
    ).not.toThrow();
  });
});
