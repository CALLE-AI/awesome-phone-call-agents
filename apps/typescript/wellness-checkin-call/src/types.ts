/**
 * The subset of CALL-E's call-task shape this app reads. Kept narrow on purpose
 * so the fake server only has to speak the fields this app actually uses.
 */
/** Matches the JS shape the `@call-e/calle` SDK returns (camelCase), not the wire JSON. */
export interface CallSnapshot {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type WellnessLevel = "ok" | "mild_concern" | "escalate";

export interface WellnessStructuredResult {
  answered: boolean;
  condition_summary?: string;
  meal_status?: "good" | "somewhat_concerning" | "unknown";
  concerns_reported?: boolean;
  concerns_detail?: string;
}

export interface ClassificationResult {
  level: WellnessLevel;
  reasons: string[];
}

export interface WellnessRequest {
  /** A stable, non-secret identifier for this recipient. Not a real name. */
  workflow_id: string;
  /** E.164 phone number. Use a fictional reserved number for examples. */
  phone: string;
  /** True only when the recipient (or whoever manages their care) asked for this call to be set up. */
  recipient_or_caregiver_opted_in: true;
}

export interface WellnessReport {
  call_id: string | null;
  level: WellnessLevel;
  reasons: string[];
  summary: string | null;
  masked_phone: string;
}
