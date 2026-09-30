export const BILLING_ERROR_CODES = [
  "billing_disabled",
  "billing_unavailable",
  "plan_not_found",
  "plan_not_billable",
  "coming_soon",
  "provider_unavailable",
  "invalid_receipt",
  "duplicate",
  "verification_failed",
  "purchase_failed",
  "insufficient_call_credits",
  "upgrade_required",
  "monthly_call_limit",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

const USER_MESSAGES: Record<BillingErrorCode, string> = {
  billing_disabled: "Billing is temporarily unavailable. Essential care features still work.",
  billing_unavailable: "Could not verify billing status. Please try again.",
  plan_not_found: "That plan is not available.",
  plan_not_billable: "This plan cannot be purchased in the app yet.",
  coming_soon: "This plan is coming soon.",
  provider_unavailable: "Payment provider is not configured.",
  invalid_receipt: "Purchase could not be verified.",
  duplicate: "This purchase was already processed.",
  verification_failed: "Purchase verification failed.",
  purchase_failed: "Purchase could not be completed.",
  insufficient_call_credits: "No call credits remaining. Upgrade or add credits.",
  upgrade_required: "Live calls require a paid plan.",
  monthly_call_limit: "Monthly live call allowance reached.",
};

export function billingErrorMessage(code: string, fallback?: string): string {
  if (code in USER_MESSAGES) {
    return USER_MESSAGES[code as BillingErrorCode];
  }
  return fallback ?? "Something went wrong. Please try again.";
}

export function isBillingErrorCode(code: string): code is BillingErrorCode {
  return (BILLING_ERROR_CODES as readonly string[]).includes(code);
}

export function isBillingUpgradeCode(code: string): boolean {
  return (
    code === "insufficient_call_credits" ||
    code === "upgrade_required" ||
    code === "monthly_call_limit"
  );
}
