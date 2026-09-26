import { randomUUID } from "node:crypto";

import type { BillingProvider, PlanCatalogEntry, SubscriptionRecord } from "./types";
import { assertSubscriptionTransition } from "./subscription-lifecycle";
import { appendAuditEntry } from "./audit-ledger";

export type PurchaseStartResult =
  | { ok: true; pendingSubscriptionId: string; provider: BillingProvider; synthetic: boolean }
  | { ok: false; code: "plan_not_billable" | "coming_soon" | "provider_unavailable" };

export type VerifyPurchaseResult =
  | { ok: true; subscription: SubscriptionRecord; transactionId: string }
  | { ok: false; code: "invalid_receipt" | "duplicate" | "verification_failed" };

export interface BillingProviderAdapter {
  provider: BillingProvider;
  startPurchase(input: {
    userId: number;
    plan: PlanCatalogEntry;
    correlationId: string;
  }): Promise<PurchaseStartResult>;
  verifyPurchase(input: {
    userId: number;
    planId: string;
    receiptToken: string;
    correlationId: string;
  }): Promise<VerifyPurchaseResult>;
  restorePurchases(input: { userId: number; correlationId: string }): Promise<VerifyPurchaseResult[]>;
}

const verifiedTransactions = new Set<string>();

export class MockBillingProvider implements BillingProviderAdapter {
  provider: BillingProvider = "mock";

  async startPurchase(input: {
    userId: number;
    plan: PlanCatalogEntry;
    correlationId: string;
  }): Promise<PurchaseStartResult> {
    if (!input.plan.billable) return { ok: false, code: "plan_not_billable" };
    if (input.plan.comingSoon) return { ok: false, code: "coming_soon" };
    return {
      ok: true,
      pendingSubscriptionId: randomUUID().replace(/-/g, "").slice(0, 24),
      provider: "mock",
      synthetic: true,
    };
  }

  async verifyPurchase(input: {
    userId: number;
    planId: string;
    receiptToken: string;
    correlationId: string;
  }): Promise<VerifyPurchaseResult> {
    try {
      if (!input.receiptToken.startsWith("mock_receipt_")) {
        return { ok: false, code: "invalid_receipt" };
      }
      const txKey = `${input.userId}:${input.receiptToken}`;
      if (verifiedTransactions.has(txKey)) {
        return { ok: false, code: "duplicate" };
      }
      verifiedTransactions.add(txKey);
      const now = new Date().toISOString();
      const subscription: SubscriptionRecord = {
        id: randomUUID().replace(/-/g, "").slice(0, 24),
        userId: input.userId,
        orgId: null,
        planId: input.planId,
        state: "pending_verification",
        provider: "mock",
        providerTransactionId: input.receiptToken,
        trialEndsAt: null,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString(),
        canceledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      assertSubscriptionTransition(subscription.state, "active");
      subscription.state = "active";
      subscription.updatedAt = new Date().toISOString();
      appendAuditEntry({
        actor: "system",
        actorUserId: input.userId,
        action: "purchase_verified",
        correlationId: input.correlationId,
        reason: "mock_provider_verification",
        after: { planId: input.planId, provider: "mock" },
      });
      return { ok: true, subscription, transactionId: input.receiptToken };
    } catch {
      return { ok: false, code: "verification_failed" };
    }
  }

  async restorePurchases(input: { userId: number; correlationId: string }) {
    void input;
    return [];
  }
}

export function resetMockBillingProvider() {
  verifiedTransactions.clear();
}

export function createBillingProvider(kind: BillingProvider): BillingProviderAdapter {
  if (kind === "mock") return new MockBillingProvider();
  throw new Error(`Billing provider ${kind} is not configured in this environment`);
}
