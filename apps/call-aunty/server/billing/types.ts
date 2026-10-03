import { z } from "zod";

/** Versioned feature keys — never compare plan names in product code. */
export const featureKeySchema = z.enum([
  "core_safety_triage",
  "emergency_guidance",
  "basic_care_visibility",
  "privacy_controls",
  "offline_work",
  "essential_calling_safeguards",
  "basic_follow_up",
  "command_center_basic",
  "call_credits_live",
  "command_center_advanced",
  "ai_call_brief_advanced",
  "hero_demo_unlimited",
  "org_dashboard",
  "export_reports",
  "workflow_automation",
  "seat_management",
  "premium_analytics",
  "org_api_access",
]);

export type FeatureKey = z.infer<typeof featureKeySchema>;

export const subscriptionStateSchema = z.enum([
  "trialing",
  "active",
  "grace_period",
  "paused",
  "past_due",
  "canceled",
  "expired",
  "refunded",
  "revoked",
  "pending_verification",
  "organization_suspended",
]);

export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

export const billingProviderSchema = z.enum([
  "mock",
  "apple",
  "google_play",
  "stripe",
  "invoice",
]);

export type BillingProvider = z.infer<typeof billingProviderSchema>;

export const planTierSchema = z.enum([
  "community_free",
  "professional",
  "clinic_team",
  "organization_ngo",
  "enterprise",
]);

export type PlanTier = z.infer<typeof planTierSchema>;

export const usageMeterKeySchema = z.enum([
  "calle_calls",
  "calle_calls_billable",
  "ai_generations",
  "ai_advanced",
  "exports",
  "automation_runs",
  "active_seats",
]);

export type UsageMeterKey = z.infer<typeof usageMeterKeySchema>;

export const revenueEventTypeSchema = z.enum([
  "pricing_viewed",
  "plan_selected",
  "purchase_started",
  "purchase_verified",
  "purchase_failed",
  "trial_started",
  "trial_converted",
  "subscription_canceled",
  "renewal_failed",
  "entitlement_granted",
  "entitlement_revoked",
  "call_credit_reserved",
  "call_credit_consumed",
  "call_credit_refunded",
  "restore_purchases",
]);

export type RevenueEventType = z.infer<typeof revenueEventTypeSchema>;

export const orgRoleSchema = z.enum(["owner", "admin", "manager", "chw", "readonly"]);

export type OrgRole = z.infer<typeof orgRoleSchema>;

export const planLimitSchema = z.object({
  meter: usageMeterKeySchema,
  included: z.number().int().nonnegative(),
  hardCap: z.number().int().nonnegative().optional(),
  period: z.enum(["month", "day", "none"]),
});

export type PlanLimit = z.infer<typeof planLimitSchema>;

export const planCatalogEntrySchema = z.object({
  catalogVersion: z.string(),
  planId: z.string(),
  tier: planTierSchema,
  displayName: z.string(),
  description: z.string(),
  currency: z.string().length(3),
  interval: z.enum(["month", "year", "none"]),
  displayPriceCents: z.number().int().nonnegative(),
  trialDays: z.number().int().nonnegative(),
  callCreditsIncluded: z.number().int().nonnegative(),
  seatsIncluded: z.number().int().nonnegative(),
  features: z.array(featureKeySchema),
  limits: z.array(planLimitSchema),
  billable: z.boolean(),
  comingSoon: z.boolean(),
  lifecycleStatus: z.enum(["active", "deprecated", "preview"]),
});

export type PlanCatalogEntry = z.infer<typeof planCatalogEntrySchema>;

export const subscriptionRecordSchema = z.object({
  id: z.string(),
  userId: z.number().int().positive(),
  orgId: z.string().nullable(),
  planId: z.string(),
  state: subscriptionStateSchema,
  provider: billingProviderSchema,
  providerTransactionId: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  canceledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>;

export const entitlementSnapshotSchema = z.object({
  snapshotVersion: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  planId: z.string(),
  tier: planTierSchema,
  subscriptionState: subscriptionStateSchema,
  features: z.array(featureKeySchema),
  limits: z.record(
    usageMeterKeySchema,
    z.object({
      included: z.number().int().nonnegative(),
      used: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      period: z.enum(["month", "day", "none"]),
    }),
  ),
  callCreditsBalance: z.number().int().nonnegative(),
  demoMode: z.boolean(),
  integrityHash: z.string(),
});

export type EntitlementSnapshot = z.infer<typeof entitlementSnapshotSchema>;

export const publicEntitlementsSchema = entitlementSnapshotSchema.pick({
  planId: true,
  tier: true,
  subscriptionState: true,
  features: true,
  limits: true,
  callCreditsBalance: true,
  demoMode: true,
  issuedAt: true,
  expiresAt: true,
});

export type PublicEntitlements = z.infer<typeof publicEntitlementsSchema>;

export const callCreditReservationSchema = z.object({
  reservationId: z.string(),
  userId: z.number().int().positive(),
  workflowId: z.string(),
  amount: z.number().int().positive(),
  status: z.enum(["reserved", "consumed", "released", "expired"]),
  idempotencyKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CallCreditReservation = z.infer<typeof callCreditReservationSchema>;

export const organizationRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  planId: z.string(),
  ownerUserId: z.number().int().positive(),
  seatLimit: z.number().int().positive(),
  activeSeats: z.number().int().nonnegative(),
  sponsorshipActive: z.boolean(),
  createdAt: z.string(),
});

export type OrganizationRecord = z.infer<typeof organizationRecordSchema>;
