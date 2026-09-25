import { billingErrorMessage, isBillingErrorCode } from "../billing/errors";
import { mapErrorToUserMessage } from "../calle/error-taxonomy";

export function resolveWorkflowErrorMessage(code: string, billingMessage?: string): string {
  if (billingMessage) return billingMessage;
  if (isBillingErrorCode(code)) return billingErrorMessage(code);
  return mapErrorToUserMessage(code).userMessage;
}

export function isUpgradeWorkflowCode(code: string): boolean {
  return (
    code === "insufficient_call_credits" ||
    code === "upgrade_required" ||
    code === "monthly_call_limit"
  );
}

export function toTrpcCause(code: string, extras?: { upgradePlanId?: string }) {
  return {
    code,
    upgradePlanId: extras?.upgradePlanId,
    upgrade: isUpgradeWorkflowCode(code),
  };
}
