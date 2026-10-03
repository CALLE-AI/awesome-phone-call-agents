// Local validation is a second safety net around CALL-E's result_schema enforcement.
import { z } from "zod";
import type { BloodInquiryResult, BloodReserveResult, CallKind, HoldResult, InquiryResult, PrescriberResult, TransferResult } from "./types";

const yesNoUnknown = z.enum(["yes", "no", "unknown"]);
const stock = z.enum(["in_stock", "partial", "out_of_stock", "refused_to_disclose", "unknown"]);
const reached = (staff: "pharmacy_staff" | "facility_staff") =>
  z.enum([staff, "automated_system_only", "voicemail", "no_answer", "wrong_number", "unknown"]);

const inquirySchema = z.object({
  reached: reached("pharmacy_staff"),
  stock_status: stock,
  can_fill_today: yesNoUnknown,
  quantity_on_hand: z.string(),
  alternative_available: z.enum(["generic", "different_strength", "different_form", "none", "not_discussed"]),
  alternative_details: z.string(),
  hold_offered: yesNoUnknown,
  hold_duration_hours: z.number(),
  ready_time: z.string(),
  cash_price: z.string(),
  restock_eta: z.string(),
  transfer_accepted: yesNoUnknown,
  staff_name: z.string(),
  evidence_quote: z.string(),
  notes: z.string(),
});

const holdSchema = z.object({
  hold_confirmed: yesNoUnknown,
  hold_name: z.string(),
  hold_until: z.string(),
  reference: z.string(),
  next_step_required: z.enum(["e_prescription_to_this_pharmacy", "transfer_existing_prescription", "bring_paper_prescription", "none", "unknown"]),
  pickup_requirements: z.string(),
  store_identifier: z.string(),
  staff_name: z.string(),
  evidence_quote: z.string(),
});

const prescriberSchema = z.object({
  request_status: z.enum(["accepted", "needs_prescriber_approval", "patient_must_call", "declined", "unknown"]),
  expected_send_time: z.string(),
  staff_name: z.string(),
  follow_up_needed: z.string(),
  evidence_quote: z.string(),
});

const transferSchema = z.object({
  reached: reached("pharmacy_staff"),
  prescription_found: yesNoUnknown,
  transfer_status: z.enum(["will_transfer", "transferred", "receiving_pharmacy_must_request", "needs_prescriber", "declined", "unknown"]),
  expected_time: z.string(),
  reference: z.string(),
  controlled_rule: z.string(),
  follow_up_needed: z.string(),
  staff_name: z.string(),
  evidence_quote: z.string(),
});

const bloodInquirySchema = z.object({
  reached: reached("facility_staff"),
  stock_status: stock,
  units_available: z.string(),
  can_issue_today: yesNoUnknown,
  reserve_offered: yesNoUnknown,
  reserve_duration_hours: z.number(),
  requisition_required: yesNoUnknown,
  crossmatch_sample_required: yesNoUnknown,
  replacement_donor_required: yesNoUnknown,
  processing_charge: z.string(),
  open_24x7: yesNoUnknown,
  referral_or_restock: z.string(),
  staff_name: z.string(),
  evidence_quote: z.string(),
  notes: z.string(),
});

const bloodReserveSchema = z.object({
  reserve_confirmed: yesNoUnknown,
  reserve_name: z.string(),
  reserve_until: z.string(),
  reference: z.string(),
  documents_required: z.string(),
  sample_required: yesNoUnknown,
  replacement_donors_required: z.string(),
  charge_per_unit: z.string(),
  staff_name: z.string(),
  evidence_quote: z.string(),
});

function parser<T>(schema: z.ZodType<T>) {
  return (value: unknown): T | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
}

export const parseInquiryResult = parser<InquiryResult>(inquirySchema);
export const parseHoldResult = parser<HoldResult>(holdSchema);
export const parsePrescriberResult = parser<PrescriberResult>(prescriberSchema);
export const parseTransferResult = parser<TransferResult>(transferSchema);
export const parseBloodInquiryResult = parser<BloodInquiryResult>(bloodInquirySchema);
export const parseBloodReserveResult = parser<BloodReserveResult>(bloodReserveSchema);

const PARSERS: Record<CallKind, (value: unknown) => unknown> = {
  inquiry: parseInquiryResult,
  hold: parseHoldResult,
  prescriber: parsePrescriberResult,
  transfer: parseTransferResult,
  blood_inquiry: parseBloodInquiryResult,
  blood_reserve: parseBloodReserveResult,
};

/** True when `value` matches the result schema for this call kind. */
export function validResultFor(kind: CallKind, value: unknown): boolean {
  return PARSERS[kind](value) !== null;
}
