import { ENV } from "../_core/env";

export type V6BillingFlags = {
  billingEnabled: boolean;
  billingDemoMode: boolean;
  indicator: "DEMO" | "LIVE_BILLING";
  mockProviderOnly: boolean;
};

export function loadV6BillingFlags(): V6BillingFlags {
  const billingDemoMode = ENV.billingDemoMode;
  return {
    billingEnabled: ENV.billingEnabled,
    billingDemoMode,
    indicator: billingDemoMode ? "DEMO" : "LIVE_BILLING",
    mockProviderOnly: billingDemoMode || !ENV.billingLiveProviders,
  };
}

export function getPublicV6BillingFlags(): V6BillingFlags {
  return loadV6BillingFlags();
}

export function assertBillingEnabled(): void {
  if (!ENV.billingEnabled) {
    throw new Error("billing_disabled");
  }
}

export function isBillingEnabled(): boolean {
  return ENV.billingEnabled;
}

export function billingEnabledGuard():
  | { ok: true }
  | { ok: false; code: "billing_disabled"; message: string } {
  if (!ENV.billingEnabled) {
    return {
      ok: false,
      code: "billing_disabled",
      message: "Billing is temporarily unavailable. Essential care features still work.",
    };
  }
  return { ok: true };
}
