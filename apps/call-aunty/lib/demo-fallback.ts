/**
 * Offline / demo mock payloads for judge demos when the API is unreachable.
 * Synthetic identities only — never real patient data.
 */

import { OPERATOR_DASHBOARD_SNAPSHOT } from "./operator-dashboard";

export const DEMO_BILLING_CATALOG = {
  catalogVersion: "v6-demo",
  synthetic: true as const,
  ethicalNote: "Emergency guidance and essential care stay free.",
  flags: {
    billingEnabled: true,
    billingDemoMode: true,
    indicator: "DEMO" as const,
    mockProviderOnly: true,
  },
  plans: [
    {
      catalogVersion: "v6-demo",
      planId: "community_free",
      tier: "community_free" as const,
      displayName: "Community (Free)",
      description: "Essential care, safety triage, privacy controls, and dry-run calling.",
      currency: "USD",
      interval: "none" as const,
      displayPriceCents: 0,
      displayPrice: "Free",
      trialDays: 0,
      callCreditsIncluded: 0,
      seatsIncluded: 1,
      features: ["core_safety_triage", "offline_work"] as string[],
      billable: false,
      comingSoon: false,
      lifecycleStatus: "active" as const,
    },
    {
      catalogVersion: "v6-demo",
      planId: "professional_chw",
      tier: "professional" as const,
      displayName: "Professional CHW",
      description: "Live call credits, advanced AI briefs, and expanded command center.",
      currency: "USD",
      interval: "month" as const,
      displayPriceCents: 2900,
      displayPrice: "$29/mo",
      trialDays: 14,
      callCreditsIncluded: 30,
      seatsIncluded: 1,
      features: ["call_credits_live", "hero_demo_unlimited"] as string[],
      billable: true,
      comingSoon: false,
      lifecycleStatus: "active" as const,
    },
    {
      catalogVersion: "v6-demo",
      planId: "clinic_team",
      tier: "clinic_team" as const,
      displayName: "Clinic / Team",
      description: "Seat management, cohort analytics, and shared call pool.",
      currency: "USD",
      interval: "month" as const,
      displayPriceCents: 9900,
      displayPrice: "$99/mo",
      trialDays: 14,
      callCreditsIncluded: 120,
      seatsIncluded: 5,
      features: ["org_dashboard", "export_reports"] as string[],
      billable: true,
      comingSoon: false,
      lifecycleStatus: "active" as const,
    },
  ],
};

export const DEMO_ENTITLEMENTS = {
  planId: "community_free",
  tier: "community_free" as const,
  subscriptionState: "none" as const,
  features: ["core_safety_triage", "offline_work", "command_center_basic"] as string[],
  limits: {},
  callCreditsBalance: 3,
  demoMode: true,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

export const DEMO_USAGE = {
  planId: "community_free",
  limits: {},
  callCreditsBalance: 3,
  reducedMode: false,
  subscriptionStateLabel: "Community (free) — demo",
};

export const DEMO_CALLE_CAPABILITIES = {
  v5Flags: {
    indicator: "DEMO" as const,
    demoMode: true,
    liveCalling: false,
  },
  publicConfig: {
    configured: false,
    liveCallsEnabled: false,
    killSwitch: false,
    demoMode: true,
    mode: "demo" as const,
    indicator: "DEMO" as const,
  },
  demoScenarios: ["instant_success", "no_answer", "safety_escalation", "busy", "voicemail"],
};

export const DEMO_COMMAND_CENTER = {
  summary: OPERATOR_DASHBOARD_SNAPSHOT.summary,
  calls: OPERATOR_DASHBOARD_SNAPSHOT.calls,
  providerHealth: OPERATOR_DASHBOARD_SNAPSHOT.providerHealth,
  incidents: OPERATOR_DASHBOARD_SNAPSHOT.incidents,
};

export const DEMO_CALL_DETAIL = {
  workflow: {
    id: "demo-wf-asha-001",
    womanId: "demo-ben-001",
    purpose: "follow_up_after_check_in",
    status: "prepared",
    policyDecision: "allow",
    callLanguage: "en",
    dryRun: true,
  },
  conversationState: "awaiting_confirm",
  outcome: {
    confidenceGate: "auto_accept",
    extracted: { disposition: "callback_scheduled" },
  },
  correlation: { correlationId: "corr_demo_asha_001" },
  events: [{ type: "prepared" }, { type: "policy_allow" }],
  callBrief: {
    recommendations: [
      "Confirm safe time to talk before dialing.",
      "Use neutral greeting for shared phones.",
      "Escalate if danger signs are mentioned.",
    ],
  },
};

export function demoCallLanguageResolution(requested: string) {
  const supportedSpoken = new Set(["en", "en-us", "en-gb", "es", "fr"]);
  const normalized = requested.toLowerCase();
  const supported = supportedSpoken.has(normalized) || supportedSpoken.has(normalized.split("-")[0] ?? "");
  return {
    requested: normalized,
    effective: supported ? normalized : "en",
    supported,
    fallbackChain: supported ? [normalized] : [normalized, "en"],
    messageCode: supported ? ("supported" as const) : ("fallback_applied" as const),
    alternatives: ["en", "es", "fr"] as const,
    preservePreference: true,
  };
}

export const DEMO_HERO_RESULT = {
  ok: true as const,
  scenario: "instant_success",
  prepared: {
    workflow: {
      id: "demo-wf-hero-live",
      womanId: "demo-ben-001",
      status: "prepared",
      dryRun: true,
    },
  },
  confirmed: {
    ok: true as const,
    workflow: { id: "demo-wf-hero-live", status: "dry_run_completed" },
  },
};
