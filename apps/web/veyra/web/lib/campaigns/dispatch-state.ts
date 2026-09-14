export type DispatchClaimAction =
  | "claim"
  | "defer"
  | "skip"
  | "require_reconciliation";

export function dispatchClaimAction(params: {
  campaignStatus: string;
  callStatus: string;
  anotherCallSubmitting: boolean;
}): DispatchClaimAction {
  if (params.campaignStatus === "reconciliation_required") return "require_reconciliation";
  if (!["launching", "launched"].includes(params.campaignStatus)) return "skip";
  if (params.callStatus === "submitting") return "require_reconciliation";
  if (params.callStatus !== "pending") return "skip";
  return params.anotherCallSubmitting ? "defer" : "claim";
}
