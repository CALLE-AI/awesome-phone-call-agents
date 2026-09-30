// File: src/lib/schemas.ts
// Deterministic core. Imports nothing outward. Schemas are byte-identical to PRD Section 5.

export type PriceBasis = "all_inclusive" | "facility_only" | "professional_only" | "unknown";
export type Outcome = "quoted" | "refused" | "needs_consult" | "voicemail" | "unknown";

export interface RecipientResult {
  reached_billing?: boolean;
  quote_given: boolean;
  cash_price?: number | null;
  currency?: string;
  price_basis?: PriceBasis;
  includes?: string[];
  excludes?: string[];
  requires_consult_first?: boolean;
  estimate_valid_days?: number | null;
  earliest_appointment_days?: number | null;
  cpt_or_code_confirmed?: string | null;
  quoted_verbatim?: string | null;
  outcome: Outcome;
}

export interface TaskRollup {
  clinics_reached: number;
  quotes_obtained: number;
  lowest_all_inclusive: number | null;
}

// ---- JSON Schemas sent to CALL-E (verbatim from SPEC) ----

export const RECIPIENT_RESULT_SCHEMA = {
  type: "object",
  properties: {
    reached_billing: { type: "boolean" },
    quote_given: { type: "boolean" },
    cash_price: { type: ["number", "null"] },
    currency: { type: "string", default: "USD" },
    price_basis: { type: "string", enum: ["all_inclusive", "facility_only", "professional_only", "unknown"] },
    includes: { type: "array", items: { type: "string" } },
    excludes: { type: "array", items: { type: "string" } },
    requires_consult_first: { type: "boolean" },
    estimate_valid_days: { type: ["integer", "null"] },
    earliest_appointment_days: { type: ["integer", "null"] },
    cpt_or_code_confirmed: { type: ["string", "null"] },
    quoted_verbatim: { type: ["string", "null"], description: "exact sentence the price was stated in" },
    outcome: { type: "string", enum: ["quoted", "refused", "needs_consult", "voicemail", "unknown"] },
  },
  required: ["quote_given", "outcome"],
} as const;

export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    clinics_reached: { type: "integer" },
    quotes_obtained: { type: "integer" },
    lowest_all_inclusive: { type: ["number", "null"] },
  },
} as const;

export function buildTaskPrompt(procedure: string, code: string | undefined, clinicName: string): string {
  const codePart = code ? ` (${code})` : "";
  return [
    `You are calling ${clinicName} on behalf of a self-pay (uninsured) patient to get a Good Faith Estimate cash price for ${procedure}${codePart}.`,
    `Identify yourself as an assistant helping a patient get a cash-pay estimate.`,
    `Ask for the ALL-INCLUSIVE cash/self-pay price. If they only give facility or professional fees separately, capture each and note the basis.`,
    `Confirm what is included and excluded (e.g., anesthesia, reading fee, follow-up).`,
    `Ask how long the estimate is valid and the earliest appointment. If they require a consult first, capture that.`,
    `Do not agree to book. Be brief and polite.`,
  ].join(" ");
}
