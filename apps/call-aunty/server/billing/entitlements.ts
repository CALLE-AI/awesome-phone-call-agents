import { createHash, randomUUID } from "node:crypto";

import type {
  FeatureKey,
  OrganizationRecord,
  SubscriptionRecord,
  UsageMeterKey,
} from "./types";
import { getPlanById } from "./catalog";
import { ALWAYS_FREE_FEATURES } from "./ethical-policy";
import { retainsPaidFeatures } from "./subscription-lifecycle";
import { getUsageForUser } from "./usage-meters";
import { getCallCreditBalance } from "./call-credit-ledger";

export type EntitlementContext = {
  userId: number;
  subscription: SubscriptionRecord | null;
  org: OrganizationRecord | null;
  orgMembershipRole?: string | null;
  promotionalFeatures?: FeatureKey[];
  demoMode?: boolean;
};

export type EffectiveEntitlements = {
  planId: string;
  tier: string;
  subscriptionState: SubscriptionRecord["state"] | "none";
  features: FeatureKey[];
  limits: Record<
    UsageMeterKey,
    { included: number; used: number; remaining: number; period: "month" | "day" | "none" }
  >;
  callCreditsBalance: number;
  reducedMode: boolean;
};

function resolvePlanId(ctx: EntitlementContext): string {
  if (ctx.org?.sponsorshipActive && ctx.org.planId) return ctx.org.planId;
  if (ctx.subscription?.state && retainsPaidFeatures(ctx.subscription.state)) {
    return ctx.subscription.planId;
  }
  return "community_free";
}

export function getEffectiveEntitlements(ctx: EntitlementContext): EffectiveEntitlements {
  const planId = resolvePlanId(ctx);
  const plan = getPlanById(planId) ?? getPlanById("community_free")!;
  const subscriptionState = ctx.subscription?.state ?? "none";
  const reducedMode =
    subscriptionState !== "none" && !retainsPaidFeatures(subscriptionState as SubscriptionRecord["state"]);

  const featureSet = new Set<FeatureKey>([...ALWAYS_FREE_FEATURES]);
  if (!reducedMode) {
    for (const f of plan.features) featureSet.add(f);
    for (const f of ctx.promotionalFeatures ?? []) featureSet.add(f);
  }
  if (ctx.demoMode) {
    featureSet.add("command_center_advanced");
    featureSet.add("hero_demo_unlimited");
  }

  const limits: EffectiveEntitlements["limits"] = {} as EffectiveEntitlements["limits"];
  for (const limit of plan.limits) {
    const used = getUsageForUser(ctx.userId, limit.meter);
    const included = reducedMode && !ALWAYS_FREE_FEATURES.has("basic_follow_up" as FeatureKey)
      ? Math.min(limit.included, used)
      : limit.included;
    limits[limit.meter] = {
      included,
      used,
      remaining: Math.max(0, included - used),
      period: limit.period,
    };
  }

  return {
    planId,
    tier: plan.tier,
    subscriptionState: subscriptionState as EffectiveEntitlements["subscriptionState"],
    features: [...featureSet],
    limits,
    callCreditsBalance: getCallCreditBalance(ctx.userId),
    reducedMode,
  };
}

export function isEntitled(ctx: EntitlementContext, feature: FeatureKey): boolean {
  if (ALWAYS_FREE_FEATURES.has(feature)) return true;
  return getEffectiveEntitlements(ctx).features.includes(feature);
}

export function limitRemaining(ctx: EntitlementContext, meter: UsageMeterKey): number {
  const ent = getEffectiveEntitlements(ctx);
  return ent.limits[meter]?.remaining ?? 0;
}

export type EntitlementViolation = {
  code: "feature_denied" | "limit_exceeded" | "insufficient_call_credits";
  feature?: FeatureKey;
  meter?: UsageMeterKey;
  message: string;
};

export function requireEntitlement(
  ctx: EntitlementContext,
  feature: FeatureKey,
): { ok: true } | { ok: false; violation: EntitlementViolation } {
  if (isEntitled(ctx, feature)) return { ok: true };
  return {
    ok: false,
    violation: {
      code: "feature_denied",
      feature,
      message: `Feature ${feature} is not included in the current plan.`,
    },
  };
}

export function buildEntitlementSnapshot(
  ctx: EntitlementContext,
  opts?: { ttlSeconds?: number },
): import("./types").EntitlementSnapshot {
  const ent = getEffectiveEntitlements(ctx);
  const plan = getPlanById(ent.planId);
  const issuedAt = new Date().toISOString();
  const ttl = opts?.ttlSeconds ?? 3600;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const subscriptionState =
    ent.subscriptionState === "none" ? ("expired" as const) : ent.subscriptionState;
  const payload = {
    snapshotVersion: "v6.0.0",
    issuedAt,
    expiresAt,
    planId: ent.planId,
    tier: plan?.tier ?? "community_free",
    subscriptionState,
    features: ent.features,
    limits: ent.limits,
    callCreditsBalance: ent.callCreditsBalance,
    demoMode: ctx.demoMode ?? false,
  } as const;

  const integrityHash = createHash("sha256")
    .update(JSON.stringify({ ...payload, userId: ctx.userId }))
    .digest("hex")
    .slice(0, 24);

  return { ...payload, integrityHash };
}

export function newSubscriptionRecord(input: {
  userId: number;
  planId: string;
  provider: SubscriptionRecord["provider"];
  state?: SubscriptionRecord["state"];
  orgId?: string | null;
}): SubscriptionRecord {
  const now = new Date().toISOString();
  const plan = getPlanById(input.planId);
  const trialEndsAt =
    plan && plan.trialDays > 0
      ? new Date(Date.now() + plan.trialDays * 86400_000).toISOString()
      : null;
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 24),
    userId: input.userId,
    orgId: input.orgId ?? null,
    planId: input.planId,
    state: input.state ?? (trialEndsAt ? "trialing" : "active"),
    provider: input.provider,
    providerTransactionId: null,
    trialEndsAt,
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString(),
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
