import type { FeatureKey } from "./types";

/**
 * Ethical monetization boundaries — never paywall these capabilities.
 * Server enforcement must mirror this list.
 */
export const ALWAYS_FREE_FEATURES: ReadonlySet<FeatureKey> = new Set([
  "core_safety_triage",
  "emergency_guidance",
  "basic_care_visibility",
  "privacy_controls",
  "offline_work",
  "essential_calling_safeguards",
  "basic_follow_up",
]);

/** Features that may be gated behind paid plans or org sponsorship. */
export const POTENTIALLY_PAID_FEATURES: ReadonlySet<FeatureKey> = new Set([
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

export type EthicalGateResult =
  | { allowed: true; reason: "always_free" | "entitled" | "demo_synthetic" }
  | { allowed: false; reason: "paywall_blocked"; feature: FeatureKey; upgradePlanId?: string };

export function assertNeverPaywalled(feature: FeatureKey): void {
  if (!ALWAYS_FREE_FEATURES.has(feature) && feature.startsWith("core_")) {
    throw new Error(`Feature ${feature} must remain free`);
  }
}

/** Ban health-attribute-based pricing signals. */
export const PROHIBITED_PRICING_SIGNALS = [
  "triage_state",
  "diagnosis",
  "pregnancy_risk",
  "distress_score",
  "vulnerability_index",
] as const;

export function isPricingSignalAllowed(signal: string): boolean {
  return !PROHIBITED_PRICING_SIGNALS.includes(signal as (typeof PROHIBITED_PRICING_SIGNALS)[number]);
}

export const ETHICAL_COPY_PRINCIPLES = {
  en: "Paid plans add workflow capacity and operational tools. Emergency care guidance and essential access stay free.",
  bn: "Paid প্ল্যান workflow ক্ষমতা যোগ করে। জরুরি পরামর্শ ও মৌলিক অ্যাক্সেস বিনামূল্যে থাকে।",
} as const;
