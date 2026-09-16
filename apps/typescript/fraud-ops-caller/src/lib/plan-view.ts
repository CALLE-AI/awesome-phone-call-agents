import { slaFor } from "./nvc";
import type { FraudOpsCase, Intent } from "./types";

export const TOOL_IDS = [
  "none",
  "check_payment_eligibility",
  "generate_hardship_plan",
  "execute_emergency_containment",
  "fetch_previous_context",
  "assign_human_spoc",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const DEMO_DISPOSITION: Record<string, string> = {
  case_demo_kyc_001: "uploading_now",
  case_demo_col_001: "ptp",
  case_demo_mer_001: "docs_promised",
  case_demo_ev_001a: "statement_taken",
  case_demo_ev_001b: "will_upload",
};

export function toolsForIntent(intent: Intent, safetySensitive?: boolean): ToolId[] {
  if (intent === "collections") {
    return ["check_payment_eligibility", "generate_hardship_plan", "assign_human_spoc"];
  }
  if (intent === "evidence_collection" || safetySensitive) {
    return ["execute_emergency_containment", "assign_human_spoc"];
  }
  return ["fetch_previous_context", "assign_human_spoc"];
}

export function maskE164(phone: string): string {
  if (!phone.startsWith("+") || phone.length < 6) {
    throw new Error("maskE164 expects E.164");
  }
  return phone.slice(0, 4) + "*".repeat(phone.length - 8) + phone.slice(-4);
}

export function demoSlaHours(fraudCase: FraudOpsCase): number | null {
  const disposition = DEMO_DISPOSITION[fraudCase.case_id];
  if (!disposition) return null;
  return slaFor(fraudCase.intent, disposition)?.followUpHours ?? null;
}
