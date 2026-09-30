import { randomUUID } from "node:crypto";

import { appendAuditEntry } from "./audit-ledger";
import { createBillingProvider, type BillingProviderAdapter } from "./billing-provider";
import {
  formatDisplayPrice,
  getPlanById,
  listBillablePlans,
  PLAN_CATALOG,
  PLAN_CATALOG_VERSION,
} from "./catalog";
import {
  consumeCallCreditReservation,
  getReservationForWorkflow,
  grantCallCredits,
  isBillableCallSuccess,
  reserveCallCredits,
} from "./call-credit-ledger";
import {
  buildEntitlementSnapshot,
  getEffectiveEntitlements,
  newSubscriptionRecord,
  type EntitlementContext,
} from "./entitlements";
import { ETHICAL_COPY_PRINCIPLES } from "./ethical-policy";
import { recordRevenueEvent, summarizeFunnel } from "./revenue-events";
import {
  getOrganizationForUser,
  getPromotionalGrants,
  getSubscription,
  setSubscription,
} from "./store";
import { subscriptionStateLabel } from "./subscription-lifecycle";
import { incrementUsage } from "./usage-meters";
import type { FeatureKey, PlanCatalogEntry, PublicEntitlements } from "./types";
import { billingErrorMessage } from "./errors";
import { billingEnabledGuard, getPublicV6BillingFlags, isBillingEnabled, loadV6BillingFlags } from "./v6-flags";
import { ENV } from "../_core/env";

export type BillingServiceDeps = {
  provider?: BillingProviderAdapter;
};

function buildContext(userId: number): EntitlementContext {
  const flags = loadV6BillingFlags();
  return {
    userId,
    subscription: getSubscription(userId),
    org: getOrganizationForUser(userId),
    promotionalFeatures: getPromotionalGrants(userId) as FeatureKey[],
    demoMode: flags.billingDemoMode,
  };
}

export function createBillingService(deps?: BillingServiceDeps) {
  const provider = deps?.provider ?? createBillingProvider("mock");

  function getCatalog() {
    return {
      catalogVersion: PLAN_CATALOG_VERSION,
      plans: PLAN_CATALOG.map((plan) => ({
        ...plan,
        displayPrice: formatDisplayPrice(plan),
      })),
      ethicalNote: ETHICAL_COPY_PRINCIPLES.en,
      flags: getPublicV6BillingFlags(),
      synthetic: loadV6BillingFlags().billingDemoMode,
    };
  }

  function getEntitlements(userId: number): PublicEntitlements {
    try {
      const snapshot = buildEntitlementSnapshot(buildContext(userId));
      const { integrityHash: _, ...pub } = snapshot;
      return pub;
    } catch {
      const snapshot = buildEntitlementSnapshot({
        userId,
        subscription: null,
        org: null,
        demoMode: true,
      });
      const { integrityHash: _, ...pub } = snapshot;
      return pub;
    }
  }

  function getEntitlementSnapshot(userId: number) {
    return buildEntitlementSnapshot(buildContext(userId));
  }

  function getUsageSummary(userId: number) {
    try {
      const ent = getEffectiveEntitlements(buildContext(userId));
      return {
        planId: ent.planId,
        limits: ent.limits,
        callCreditsBalance: ent.callCreditsBalance,
        reducedMode: ent.reducedMode,
        subscriptionStateLabel:
          ent.subscriptionState === "none"
            ? "Community (free)"
            : subscriptionStateLabel(ent.subscriptionState),
      };
    } catch {
      return {
        planId: "community_free",
        limits: {},
        callCreditsBalance: 0,
        reducedMode: false,
        subscriptionStateLabel: "Community (free)",
      };
    }
  }

  async function startPurchase(userId: number, planId: string) {
    const guard = billingEnabledGuard();
    if (!guard.ok) return guard;
    try {
      const plan = getPlanById(planId);
      if (!plan) return { ok: false as const, code: "plan_not_found" as const };
      const correlationId = randomUUID().replace(/-/g, "").slice(0, 24);
      recordRevenueEvent({ eventType: "plan_selected", userId, planId, correlationId });
      recordRevenueEvent({ eventType: "purchase_started", userId, planId, correlationId });
      const result = await provider.startPurchase({ userId, plan, correlationId });
      if (!result.ok) {
        recordRevenueEvent({
          eventType: "purchase_failed",
          userId,
          planId,
          correlationId,
          meta: { code: result.code },
        });
        return result;
      }
      return { ...result, planId, correlationId };
    } catch {
      return {
        ok: false as const,
        code: "billing_unavailable" as const,
        message: billingErrorMessage("billing_unavailable"),
      };
    }
  }

  async function verifyPurchase(userId: number, planId: string, receiptToken: string) {
    const guard = billingEnabledGuard();
    if (!guard.ok) return guard;
    try {
      const correlationId = randomUUID().replace(/-/g, "").slice(0, 24);
      const result = await provider.verifyPurchase({
        userId,
        planId,
        receiptToken,
        correlationId,
      });
      if (!result.ok) {
        recordRevenueEvent({
          eventType: "purchase_failed",
          userId,
          planId,
          correlationId,
          meta: { code: result.code },
        });
        return result;
      }
      setSubscription(result.subscription);
      const plan = getPlanById(planId);
      if (plan && plan.callCreditsIncluded > 0) {
        grantCallCredits({
          userId,
          amount: plan.callCreditsIncluded,
          idempotencyKey: `grant:${result.transactionId}`,
        });
      }
      recordRevenueEvent({ eventType: "purchase_verified", userId, planId, correlationId });
      recordRevenueEvent({ eventType: "entitlement_granted", userId, planId, correlationId });
      appendAuditEntry({
        actor: "user",
        actorUserId: userId,
        action: "entitlement_granted",
        correlationId,
        reason: "purchase_verified",
        after: { planId },
      });
      return result;
    } catch {
      return { ok: false as const, code: "verification_failed" as const };
    }
  }

  async function restorePurchases(userId: number) {
    const guard = billingEnabledGuard();
    if (!guard.ok) {
      return { ok: false as const, restored: [] as const, code: guard.code, message: guard.message };
    }
    try {
      const correlationId = randomUUID().replace(/-/g, "").slice(0, 24);
      recordRevenueEvent({ eventType: "restore_purchases", userId, correlationId });
      const restored = await provider.restorePurchases({ userId, correlationId });
      return { ok: true as const, restored };
    } catch {
      return {
        ok: false as const,
        code: "billing_unavailable" as const,
        message: billingErrorMessage("billing_unavailable"),
        restored: [] as const,
      };
    }
  }

  function recordPricingViewed(userId: number) {
    try {
      recordRevenueEvent({ eventType: "pricing_viewed", userId });
    } catch {
      // Analytics must not block UI.
    }
  }

  /** Budget gate for live (non-dry-run) CALL-E dispatch. Dry-run always allowed. */
  function validateLiveCallBudget(
    userId: number,
    opts: { dryRun: boolean; workflowId: string },
  ):
    | { ok: true; dryRun: true }
    | { ok: true; dryRun: false; reservationId: string }
    | { ok: false; code: string; message: string; upgradePlanId?: string } {
    try {
      if (opts.dryRun) return { ok: true, dryRun: true };

      const ctx = buildContext(userId);
      const ent = getEffectiveEntitlements(ctx);
      if (!ent.features.includes("call_credits_live") && !ctx.demoMode) {
        return {
          ok: false,
          code: "upgrade_required",
          message: billingErrorMessage("upgrade_required"),
          upgradePlanId: "professional_chw",
        };
      }

      const meterCheck = ent.limits.calle_calls_billable;
      if (meterCheck && meterCheck.remaining <= 0) {
        return {
          ok: false,
          code: "monthly_call_limit",
          message: billingErrorMessage("monthly_call_limit"),
          upgradePlanId: "clinic_team",
        };
      }

      const reserve = reserveCallCredits({
        userId,
        workflowId: opts.workflowId,
        idempotencyKey: `reserve:${opts.workflowId}`,
      });
      if (!reserve.ok) {
        return {
          ok: false,
          code: "insufficient_call_credits",
          message: billingErrorMessage("insufficient_call_credits"),
          upgradePlanId: "professional_chw",
        };
      }

      recordRevenueEvent({
        eventType: "call_credit_reserved",
        userId,
        meta: { workflowId: opts.workflowId, amount: 1 },
      });
      incrementUsage({
        userId,
        meter: "calle_calls",
        idempotencyKey: `attempt:${opts.workflowId}`,
        outcome: "attempted",
      });

      return { ok: true, dryRun: false, reservationId: reserve.reservation.reservationId };
    } catch {
      return {
        ok: false,
        code: "billing_unavailable",
        message: billingErrorMessage("billing_unavailable"),
      };
    }
  }

  function finalizeCallBilling(input: {
    userId: number;
    workflowId: string;
    status: string;
    dryRun: boolean;
  }) {
    try {
      if (input.dryRun) {
        incrementUsage({
          userId: input.userId,
          meter: "calle_calls",
          idempotencyKey: `dry:${input.workflowId}`,
          outcome: "successful",
        });
        return { consumed: false as const };
      }

      const reservation =
        getReservationForWorkflow(input.workflowId) ??
        (() => {
          const r = reserveCallCredits({
            userId: input.userId,
            workflowId: input.workflowId,
            idempotencyKey: `late-reserve:${input.workflowId}`,
          });
          return r.ok ? r.reservation : undefined;
        })();

      if (!reservation) return { consumed: false as const, code: "no_reservation" as const };

      const billable = isBillableCallSuccess(input.status, input.dryRun);
      consumeCallCreditReservation({
        reservationId: reservation.reservationId,
        idempotencyKey: `consume:${input.workflowId}:${input.status}`,
        billableSuccess: billable,
      });

      if (billable) {
        recordRevenueEvent({
          eventType: "call_credit_consumed",
          userId: input.userId,
          meta: { workflowId: input.workflowId },
        });
        incrementUsage({
          userId: input.userId,
          meter: "calle_calls_billable",
          idempotencyKey: `billable:${input.workflowId}`,
          outcome: "billable",
        });
      } else {
        recordRevenueEvent({
          eventType: "call_credit_refunded",
          userId: input.userId,
          meta: { workflowId: input.workflowId, reason: input.status },
        });
      }

      incrementUsage({
        userId: input.userId,
        meter: "calle_calls",
        idempotencyKey: `done:${input.workflowId}`,
        outcome: billable ? "successful" : "failed",
      });

      return { consumed: billable };
    } catch {
      return { consumed: false as const, code: "billing_unavailable" as const };
    }
  }

  function explainPlan(planId: string, language: "en" | "bn" = "en") {
    const plan = getPlanById(planId);
    if (!plan) return { ok: false as const, code: "plan_not_found" as const };
    const bullets =
      language === "bn"
        ? [
            `${plan.displayName}: ${plan.description}`,
            `কল ক্রেডিট: ${plan.callCreditsIncluded}`,
            `সিট: ${plan.seatsIncluded}`,
            plan.comingSoon ? "শীঘ্রই আসছে — এখনো কেনা যাবে না" : "ডেমো মোক কেনাকাটা উপলব্ধ",
          ]
        : [
            `${plan.displayName}: ${plan.description}`,
            `Included call credits: ${plan.callCreditsIncluded}`,
            `Seats: ${plan.seatsIncluded}`,
            `Price: ${formatDisplayPrice(plan)}`,
            plan.comingSoon ? "Coming soon — not yet purchasable" : "Demo mock purchase available",
          ];
    return {
      ok: true as const,
      planId,
      displayPrice: formatDisplayPrice(plan),
      bullets,
      source: "rule_based_catalog" as const,
      synthetic: loadV6BillingFlags().billingDemoMode,
    };
  }

  function getRevenueDashboard(requesterRole: string) {
    if (requesterRole !== "admin") {
      return { ok: false as const, code: "forbidden" as const };
    }
    const funnel = summarizeFunnel();
    return {
      ok: true as const,
      synthetic: true,
      label: "DEMO — synthetic monetization metrics",
      activePaidAccounts: listBillablePlans().length,
      grossTransactions: funnel.counts.purchase_verified ?? 0,
      conversionRate: funnel.conversionRate,
      funnel: funnel.counts,
    };
  }

  function seedDemoEntitlements(userId: number) {
    try {
      if (!isBillingEnabled()) return;
      if (!getSubscription(userId)) {
        const sub = newSubscriptionRecord({
          userId,
          planId: "community_free",
          provider: "mock",
          state: "active",
        });
        setSubscription(sub);
      }
      grantCallCredits({
        userId,
        amount: 5,
        idempotencyKey: `demo-seed:${userId}`,
      });
    } catch {
      // Demo seed must not break entitlements reads.
    }
  }

  return {
    getCatalog,
    getEntitlements,
    getEntitlementSnapshot,
    getUsageSummary,
    startPurchase,
    verifyPurchase,
    restorePurchases,
    recordPricingViewed,
    validateLiveCallBudget,
    finalizeCallBilling,
    explainPlan,
    getRevenueDashboard,
    seedDemoEntitlements,
    buildContext,
  };
}

export const billingService = createBillingService();

export type BillingService = ReturnType<typeof createBillingService>;
