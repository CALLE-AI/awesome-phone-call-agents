// src/types.ts
// Shared TypeScript interfaces for the insurance claims orchestrator.

export type CallOutcome =
  | "completed"
  | "voicemail"
  | "no_answer"
  | "refused"
  | "unclear";

export interface LossReportResult {
  outcome: CallOutcome;
  incident_description: string | null;
  incident_date: string | null;
  estimated_damage: number | null;
  policy_number_confirmed: string | null;
}

export interface CoverageVerifyResult {
  outcome: CallOutcome;
  policy_active: boolean | null;
  coverage_verified: "yes" | "no" | "unknown";
  prior_claims_12mo: boolean | null;
  adjuster_notified: boolean;
  claimant_questions: string | null;
}
