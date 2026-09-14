import { z } from "zod";
import { WEEKDAYS, type CenterResult } from "./types.ts";

export const CENTER_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "line_outcome",
    "business_confirmed",
    "age_band_accepted",
    "vacancy_status",
    "earliest_start_date",
    "available_weekdays",
    "opening_time",
    "closing_time",
    "monthly_tuition_minor",
    "registration_fee_minor",
    "subsidy_status",
    "tour_status",
    "tour_windows",
    "availability_evidence",
    "schedule_evidence",
    "fee_evidence"
  ],
  properties: {
    line_outcome: {
      type: "string",
      enum: ["reached_staff", "voicemail", "ivr_dead_end", "disconnected", "wrong_entity", "declined", "unknown"],
      description: "Use reached_staff only when a person at the intended childcare center answered and engaged."
    },
    business_confirmed: { type: "string", enum: ["yes", "no", "unknown"] },
    age_band_accepted: { type: "string", enum: ["yes", "no", "unknown"] },
    vacancy_status: {
      type: "string",
      enum: ["available", "available_later", "waitlist", "full", "unknown"],
      description: "Use available only for a current opening and available_later for an opening after the requested start date."
    },
    earliest_start_date: {
      type: "string",
      description: "Confirmed earliest start date in YYYY-MM-DD, or an empty string when unknown."
    },
    available_weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAYS] }, uniqueItems: true },
    opening_time: { type: "string", description: "Opening time in local 24-hour HH:mm, or empty when unknown." },
    closing_time: { type: "string", description: "Closing time in local 24-hour HH:mm, or empty when unknown." },
    monthly_tuition_minor: { type: "integer", description: "Monthly tuition in minor currency units, or -1 when unknown." },
    registration_fee_minor: { type: "integer", description: "One-time registration fee in minor units, or -1 when unknown." },
    subsidy_status: { type: "string", enum: ["accepted", "not_accepted", "unknown"] },
    tour_status: { type: "string", enum: ["offered", "not_offered", "unknown"] },
    tour_windows: { type: "array", items: { type: "string" }, maxItems: 4 },
    availability_evidence: { type: "string", description: "Short verbatim quote supporting the vacancy answer, or empty." },
    schedule_evidence: { type: "string", description: "Short verbatim quote supporting days and hours, or empty." },
    fee_evidence: { type: "string", description: "Short verbatim quote supporting tuition and fees, or empty." }
  }
} as const;

export const TOUR_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "confirmed_window", "next_step", "reference", "evidence"],
  properties: {
    outcome: { type: "string", enum: ["confirmed", "alternative_offered", "callback_required", "declined", "unknown"] },
    confirmed_window: { type: "string", description: "Confirmed tour date and time, or empty when not confirmed." },
    next_step: { type: "string", description: "Staff-stated next step, or empty when unknown." },
    reference: { type: "string", description: "Staff-provided reference or contact name, or empty." },
    evidence: { type: "string", description: "Short verbatim quote supporting the outcome, or empty." }
  }
} as const;

const centerResultSchema = z.object({
  line_outcome: z.enum(["reached_staff", "voicemail", "ivr_dead_end", "disconnected", "wrong_entity", "declined", "unknown"]),
  business_confirmed: z.enum(["yes", "no", "unknown"]),
  age_band_accepted: z.enum(["yes", "no", "unknown"]),
  vacancy_status: z.enum(["available", "available_later", "waitlist", "full", "unknown"]),
  earliest_start_date: z.string(),
  available_weekdays: z.array(z.enum(WEEKDAYS)).max(5),
  opening_time: z.string(),
  closing_time: z.string(),
  monthly_tuition_minor: z.number().int().min(-1),
  registration_fee_minor: z.number().int().min(-1),
  subsidy_status: z.enum(["accepted", "not_accepted", "unknown"]),
  tour_status: z.enum(["offered", "not_offered", "unknown"]),
  tour_windows: z.array(z.string()).max(4),
  availability_evidence: z.string(),
  schedule_evidence: z.string(),
  fee_evidence: z.string()
}).strict();

export function parseCenterResult(input: unknown): CenterResult | null {
  const parsed = centerResultSchema.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data;
  return {
    lineOutcome: value.line_outcome,
    businessConfirmed: value.business_confirmed,
    ageBandAccepted: value.age_band_accepted,
    vacancyStatus: value.vacancy_status,
    earliestStartDate: value.earliest_start_date,
    availableWeekdays: value.available_weekdays,
    openingTime: value.opening_time,
    closingTime: value.closing_time,
    monthlyTuitionMinor: value.monthly_tuition_minor,
    registrationFeeMinor: value.registration_fee_minor,
    subsidyStatus: value.subsidy_status,
    tourStatus: value.tour_status,
    tourWindows: value.tour_windows,
    availabilityEvidence: value.availability_evidence,
    scheduleEvidence: value.schedule_evidence,
    feeEvidence: value.fee_evidence
  };
}

const tourResultSchema = z.object({
  outcome: z.enum(["confirmed", "alternative_offered", "callback_required", "declined", "unknown"]),
  confirmed_window: z.string(),
  next_step: z.string(),
  reference: z.string(),
  evidence: z.string(),
}).strict();

export function parseTourResult(input: unknown) {
  const parsed = tourResultSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    outcome: parsed.data.outcome,
    confirmedWindow: parsed.data.confirmed_window,
    nextStep: parsed.data.next_step,
    reference: parsed.data.reference,
    evidence: parsed.data.evidence,
  };
}
