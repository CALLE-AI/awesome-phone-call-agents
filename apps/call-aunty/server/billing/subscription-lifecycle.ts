import type { SubscriptionState } from "./types";

export type SubscriptionTransition = {
  from: SubscriptionState;
  to: SubscriptionState;
  reason: string;
};

const ALLOWED: SubscriptionTransition[] = [
  { from: "pending_verification", to: "trialing", reason: "purchase_verified" },
  { from: "pending_verification", to: "active", reason: "purchase_verified_no_trial" },
  { from: "pending_verification", to: "revoked", reason: "verification_failed" },
  { from: "trialing", to: "active", reason: "trial_converted" },
  { from: "trialing", to: "expired", reason: "trial_ended" },
  { from: "trialing", to: "canceled", reason: "user_canceled" },
  { from: "active", to: "grace_period", reason: "renewal_failed" },
  { from: "active", to: "canceled", reason: "user_canceled" },
  { from: "active", to: "paused", reason: "user_paused" },
  { from: "grace_period", to: "active", reason: "payment_recovered" },
  { from: "grace_period", to: "past_due", reason: "grace_elapsed" },
  { from: "grace_period", to: "canceled", reason: "user_canceled" },
  { from: "past_due", to: "active", reason: "payment_recovered" },
  { from: "past_due", to: "expired", reason: "past_due_elapsed" },
  { from: "paused", to: "active", reason: "user_resumed" },
  { from: "canceled", to: "expired", reason: "period_ended" },
  { from: "active", to: "refunded", reason: "refund_issued" },
  { from: "trialing", to: "refunded", reason: "refund_issued" },
  { from: "active", to: "organization_suspended", reason: "org_admin_action" },
  { from: "organization_suspended", to: "active", reason: "org_reinstated" },
];

export function canTransitionSubscription(from: SubscriptionState, to: SubscriptionState): boolean {
  if (from === to) return true;
  return ALLOWED.some((t) => t.from === from && t.to === to);
}

export function assertSubscriptionTransition(from: SubscriptionState, to: SubscriptionState): void {
  if (!canTransitionSubscription(from, to)) {
    throw new Error(`Illegal subscription transition: ${from} → ${to}`);
  }
}

/** States that retain essential (free) access but may reduce paid operational features. */
export const REDUCED_MODE_STATES: ReadonlySet<SubscriptionState> = new Set([
  "grace_period",
  "past_due",
  "paused",
  "organization_suspended",
]);

export function subscriptionStateLabel(state: SubscriptionState): string {
  const labels: Record<SubscriptionState, string> = {
    trialing: "Trial active",
    active: "Active",
    grace_period: "Payment issue — grace period",
    paused: "Paused",
    past_due: "Past due",
    canceled: "Canceled — access until period end",
    expired: "Expired",
    refunded: "Refunded",
    revoked: "Revoked",
    pending_verification: "Verifying purchase",
    organization_suspended: "Organization suspended",
  };
  return labels[state];
}

export function retainsPaidFeatures(state: SubscriptionState): boolean {
  return state === "active" || state === "trialing" || state === "grace_period";
}
