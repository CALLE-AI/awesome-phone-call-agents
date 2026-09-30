import type { FeatureKey, UsageMeterKey } from "./types";
import {
  getEffectiveEntitlements,
  isEntitled,
  limitRemaining,
  requireEntitlement,
  type EntitlementContext,
  type EntitlementViolation,
} from "./entitlements";
import { ALWAYS_FREE_FEATURES } from "./ethical-policy";

export { isEntitled, limitRemaining, requireEntitlement, getEffectiveEntitlements };
export type { EntitlementContext, EntitlementViolation };

export function requireMeterCapacity(
  ctx: EntitlementContext,
  meter: UsageMeterKey,
  units = 1,
): { ok: true; remaining: number } | { ok: false; violation: EntitlementViolation } {
  const remaining = limitRemaining(ctx, meter);
  if (remaining >= units) return { ok: true, remaining: remaining - units };
  return {
    ok: false,
    violation: {
      code: "limit_exceeded",
      meter,
      message: `Usage limit exceeded for ${meter}.`,
    },
  };
}

export function requireCallCredits(
  ctx: EntitlementContext,
  amount = 1,
): { ok: true; balance: number } | { ok: false; violation: EntitlementViolation } {
  const ent = getEffectiveEntitlements(ctx);
  if (!isEntitled(ctx, "call_credits_live") && !ctx.demoMode) {
    return {
      ok: false,
      violation: {
        code: "feature_denied",
        feature: "call_credits_live",
        message: "Live call credits require a paid plan.",
      },
    };
  }
  if (ent.callCreditsBalance < amount) {
    return {
      ok: false,
      violation: {
        code: "insufficient_call_credits",
        message: "Insufficient call credits for a live call.",
      },
    };
  }
  return { ok: true, balance: ent.callCreditsBalance };
}

export function describeFeatureForUi(feature: FeatureKey, language: "en" | "bn" = "en"): string {
  const labels: Record<FeatureKey, { en: string; bn: string }> = {
    core_safety_triage: { en: "Safety triage", bn: "নিরাপত্তা ট্রায়েজ" },
    emergency_guidance: { en: "Emergency guidance", bn: "জরুরি নির্দেশনা" },
    basic_care_visibility: { en: "Care plan visibility", bn: "যত্ন পরিকল্পনা দেখা" },
    privacy_controls: { en: "Privacy controls", bn: "গোপনীয়তা নিয়ন্ত্রণ" },
    offline_work: { en: "Offline work", bn: "অফলাইন কাজ" },
    essential_calling_safeguards: { en: "Calling safeguards", bn: "কল সুরক্ষা" },
    basic_follow_up: { en: "Basic follow-up", bn: "মৌলিক ফলো-আপ" },
    command_center_basic: { en: "Call list", bn: "কল তালিকা" },
    call_credits_live: { en: "Live call credits", bn: "লাইভ কল ক্রেডিট" },
    command_center_advanced: { en: "Advanced command center", bn: "উন্নত কমান্ড সেন্টার" },
    ai_call_brief_advanced: { en: "Advanced AI briefs", bn: "উন্নত AI ব্রিফ" },
    hero_demo_unlimited: { en: "Hero demo runs", bn: "হিরো ডেমো" },
    org_dashboard: { en: "Organization dashboard", bn: "সংস্থা ড্যাশবোর্ড" },
    export_reports: { en: "Export reports", bn: "রিপোর্ট এক্সপোর্ট" },
    workflow_automation: { en: "Workflow automation", bn: "workflow অটোমেশন" },
    seat_management: { en: "Seat management", bn: "সিট ব্যবস্থাপনা" },
    premium_analytics: { en: "Premium analytics", bn: "প্রিমিয়াম বিশ্লেষণ" },
    org_api_access: { en: "Organization API", bn: "সংস্থা API" },
  };
  const row = labels[feature];
  return language === "bn" ? row.bn : row.en;
}

export function isAlwaysFree(feature: FeatureKey): boolean {
  return ALWAYS_FREE_FEATURES.has(feature);
}
