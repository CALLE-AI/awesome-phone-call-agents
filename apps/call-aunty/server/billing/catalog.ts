import type { FeatureKey, PlanCatalogEntry } from "./types";

export const PLAN_CATALOG_VERSION = "v6.0.0";

const FREE_FEATURES: FeatureKey[] = [
  "core_safety_triage",
  "emergency_guidance",
  "basic_care_visibility",
  "privacy_controls",
  "offline_work",
  "essential_calling_safeguards",
  "basic_follow_up",
  "command_center_basic",
];

/** Server-authoritative plan catalog — UI reads via tRPC, never hard-codes prices. */
export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    catalogVersion: PLAN_CATALOG_VERSION,
    planId: "community_free",
    tier: "community_free",
    displayName: "Community (Free)",
    description:
      "Essential care access, safety triage, privacy controls, offline work, and dry-run calling safeguards.",
    currency: "USD",
    interval: "none",
    displayPriceCents: 0,
    trialDays: 0,
    callCreditsIncluded: 0,
    seatsIncluded: 1,
    features: FREE_FEATURES,
    limits: [
      { meter: "calle_calls", included: 999, hardCap: 999, period: "month" },
      { meter: "ai_generations", included: 50, period: "month" },
      { meter: "exports", included: 0, period: "month" },
    ],
    billable: false,
    comingSoon: false,
    lifecycleStatus: "active",
  },
  {
    catalogVersion: PLAN_CATALOG_VERSION,
    planId: "professional_chw",
    tier: "professional",
    displayName: "Professional CHW",
    description:
      "Operational productivity: live call credits, advanced AI briefs, expanded command center, and exports.",
    currency: "USD",
    interval: "month",
    displayPriceCents: 2900,
    trialDays: 14,
    callCreditsIncluded: 30,
    seatsIncluded: 1,
    features: [
      ...FREE_FEATURES,
      "call_credits_live",
      "command_center_advanced",
      "ai_call_brief_advanced",
      "hero_demo_unlimited",
      "export_reports",
    ],
    limits: [
      { meter: "calle_calls_billable", included: 30, hardCap: 100, period: "month" },
      { meter: "ai_advanced", included: 200, period: "month" },
      { meter: "exports", included: 10, period: "month" },
    ],
    billable: true,
    comingSoon: false,
    lifecycleStatus: "active",
  },
  {
    catalogVersion: PLAN_CATALOG_VERSION,
    planId: "clinic_team",
    tier: "clinic_team",
    displayName: "Clinic / Team",
    description:
      "Seat management, organization dashboard, cohort analytics, audit-friendly exports, and team call pool.",
    currency: "USD",
    interval: "month",
    displayPriceCents: 9900,
    trialDays: 14,
    callCreditsIncluded: 150,
    seatsIncluded: 10,
    features: [
      ...FREE_FEATURES,
      "call_credits_live",
      "command_center_advanced",
      "ai_call_brief_advanced",
      "hero_demo_unlimited",
      "org_dashboard",
      "export_reports",
      "seat_management",
      "premium_analytics",
      "workflow_automation",
    ],
    limits: [
      { meter: "calle_calls_billable", included: 150, hardCap: 500, period: "month" },
      { meter: "active_seats", included: 10, hardCap: 25, period: "none" },
      { meter: "ai_advanced", included: 1000, period: "month" },
      { meter: "exports", included: 50, period: "month" },
    ],
    billable: true,
    comingSoon: false,
    lifecycleStatus: "active",
  },
  {
    catalogVersion: PLAN_CATALOG_VERSION,
    planId: "organization_ngo",
    tier: "organization_ngo",
    displayName: "Organization / NGO",
    description:
      "Sponsored CHW access, configurable retention hooks, invoicing-ready contracts, and expanded usage pools.",
    currency: "USD",
    interval: "month",
    displayPriceCents: 0,
    trialDays: 30,
    callCreditsIncluded: 500,
    seatsIncluded: 50,
    features: [
      ...FREE_FEATURES,
      "call_credits_live",
      "command_center_advanced",
      "ai_call_brief_advanced",
      "org_dashboard",
      "export_reports",
      "seat_management",
      "premium_analytics",
      "workflow_automation",
      "org_api_access",
    ],
    limits: [
      { meter: "calle_calls_billable", included: 500, period: "month" },
      { meter: "active_seats", included: 50, period: "none" },
    ],
    billable: false,
    comingSoon: true,
    lifecycleStatus: "preview",
  },
  {
    catalogVersion: PLAN_CATALOG_VERSION,
    planId: "enterprise_contract",
    tier: "enterprise",
    displayName: "Enterprise Contract",
    description: "Manual billing, SSO-ready hooks, custom limits, and implementation support metadata.",
    currency: "USD",
    interval: "year",
    displayPriceCents: 0,
    trialDays: 0,
    callCreditsIncluded: 0,
    seatsIncluded: 0,
    features: [...FREE_FEATURES, "org_api_access"],
    limits: [],
    billable: false,
    comingSoon: true,
    lifecycleStatus: "preview",
  },
];

export function getPlanById(planId: string): PlanCatalogEntry | undefined {
  return PLAN_CATALOG.find((p) => p.planId === planId);
}

export function listBillablePlans(): PlanCatalogEntry[] {
  return PLAN_CATALOG.filter((p) => p.billable && !p.comingSoon);
}

export function formatDisplayPrice(plan: PlanCatalogEntry): string {
  if (plan.displayPriceCents === 0) return plan.billable ? "Contact us" : "Free";
  const dollars = (plan.displayPriceCents / 100).toFixed(2);
  const suffix = plan.interval === "month" ? "/mo" : plan.interval === "year" ? "/yr" : "";
  return `$${dollars}${suffix}`;
}
