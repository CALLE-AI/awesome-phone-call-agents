// The CALL-E briefs and result schemas: the agents' playbook. Each brief is a structured BriefSpec
// that the UI renders as cards, and the exact task text sent to CALL-E is rendered from the same
// object, so what an operator reviews is exactly what the agent is told.
import {
  BLOOD_COMPONENTS,
  type BloodInquiryResult,
  type BloodRequest,
  type BriefSpec,
  type CallKind,
  type Facility,
  type HoldContact,
  type HoldResult,
  type InquiryResult,
  type Medication,
  type PrescriberContact,
  type TransferContact,
  type Urgency,
} from "./types";

const yesNoUnknown = (description: string) => ({ type: "string", enum: ["yes", "no", "unknown"], description });
const text = (description: string) => ({ type: "string", description });
const hours = (description: string) => ({ type: "number", description });

// CALL-E supports type/properties/required/enum/description/additionalProperties:false. There are
// no nullable types, so "not stated" is an empty string or 0, and every field is required.
function strictObject(properties: Record<string, object>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

const STOCK_ENUM = ["in_stock", "partial", "out_of_stock", "refused_to_disclose", "unknown"];

export const INQUIRY_RESULT_SCHEMA = strictObject({
  reached: {
    type: "string",
    enum: ["pharmacy_staff", "automated_system_only", "voicemail", "no_answer", "wrong_number", "unknown"],
    description:
      "Who the agent actually spoke with. pharmacy_staff only if a human at the pharmacy answered questions. automated_system_only if the call never got past a phone menu. voicemail if an answering machine took the call. wrong_number if the business said it is not a pharmacy.",
  },
  stock_status: {
    type: "string",
    enum: STOCK_ENUM,
    description:
      "in_stock only if staff clearly said the exact medication, strength, and form is physically on hand now in at least the requested quantity. partial if they have some but less than requested. out_of_stock if they clearly said they do not have it. refused_to_disclose if they said they cannot share inventory by phone. unknown in every other case. Never infer stock from tone.",
  },
  can_fill_today: yesNoUnknown("yes only if staff said a valid prescription could be filled today."),
  quantity_on_hand: text("Quantity staff stated, in their own words (e.g. 'two 100 mL bottles'). Empty string if not stated."),
  alternative_available: {
    type: "string",
    enum: ["generic", "different_strength", "different_form", "none", "not_discussed"],
    description:
      "If the exact item is unavailable, what staff said IS in stock instead. none if they said nothing suitable is in stock. not_discussed if the topic did not come up.",
  },
  alternative_details: text("The exact alternative staff mentioned, e.g. '250 mg/5 mL suspension, a few bottles'. Empty string if none."),
  hold_offered: yesNoUnknown("yes if staff agreed they could set stock aside for this patient."),
  hold_duration_hours: hours("How many hours staff said they would hold it. 0 if not offered or not stated."),
  ready_time: text("When staff said it could be ready, in their words. Empty string if not stated."),
  cash_price: text("Cash price without insurance exactly as staff stated, e.g. '$18.40'. Empty string if not stated. Never estimate."),
  restock_eta: text("When staff expects the next delivery, in their words. Empty string if not stated."),
  transfer_accepted: yesNoUnknown(
    "yes if staff said they can accept a prescription sent electronically by the prescriber or transferred from another pharmacy.",
  ),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  evidence_quote: text("One short verbatim quote from pharmacy staff that best supports stock_status. Empty string if staff said nothing relevant."),
  notes: text("Anything else operationally important, e.g. 'pharmacist back at 2 PM'. Empty string if none."),
});

export const HOLD_RESULT_SCHEMA = strictObject({
  hold_confirmed: yesNoUnknown("yes only if staff explicitly agreed to set the medication aside under the given name."),
  hold_name: text("The name the hold is under, as confirmed by staff. Empty string if no hold."),
  hold_until: text("How long staff said they will keep it, in their words. Empty string if not stated."),
  reference: text("Any hold or reference number staff gave. Empty string if none."),
  next_step_required: {
    type: "string",
    enum: ["e_prescription_to_this_pharmacy", "transfer_existing_prescription", "bring_paper_prescription", "none", "unknown"],
    description: "What staff said must happen before the prescription can be filled.",
  },
  pickup_requirements: text("What the patient must bring at pickup (ID, insurance card, etc.). Empty string if not stated."),
  store_identifier: text("Store number or other identifier staff gave for e-prescribing. Empty string if none."),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  evidence_quote: text("One short verbatim quote from staff that supports hold_confirmed. Empty string if none."),
});

export const PRESCRIBER_RESULT_SCHEMA = strictObject({
  request_status: {
    type: "string",
    enum: ["accepted", "needs_prescriber_approval", "patient_must_call", "declined", "unknown"],
    description:
      "accepted if staff agreed to send the prescription to the named pharmacy. needs_prescriber_approval if they must check with the prescriber first. patient_must_call if they require the patient to call personally. declined if they refused.",
  },
  expected_send_time: text("When staff said the prescription would be sent, in their words. Empty string if not stated."),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  follow_up_needed: text("Anything the patient or caregiver still has to do. Empty string if nothing."),
  evidence_quote: text("One short verbatim quote from staff that supports request_status. Empty string if none."),
});

export const BLOOD_INQUIRY_RESULT_SCHEMA = strictObject({
  reached: {
    type: "string",
    enum: ["facility_staff", "automated_system_only", "voicemail", "no_answer", "wrong_number", "unknown"],
    description:
      "Who the agent actually spoke with. facility_staff only if a person at the blood bank answered questions. automated_system_only if the call never got past a phone menu. voicemail if an answering machine took the call. wrong_number if the business said it is not a blood bank.",
  },
  stock_status: {
    type: "string",
    enum: STOCK_ENUM,
    description:
      "in_stock only if staff clearly said at least the requested number of units of the exact blood group and component are available now. partial if they have some but fewer units than requested. out_of_stock if they clearly said none are available. refused_to_disclose if they said they cannot share stock by phone. unknown in every other case. Never infer availability from tone.",
  },
  units_available: text("How many units staff said are available, in their words (e.g. 'four units'). Empty string if not stated."),
  can_issue_today: yesNoUnknown("yes only if staff said the units could be issued today once their requirements are met."),
  reserve_offered: yesNoUnknown("yes if staff agreed they could reserve or keep the units aside for this patient."),
  reserve_duration_hours: hours("How many hours staff said they would keep the units reserved. 0 if not offered or not stated."),
  requisition_required: yesNoUnknown("yes if staff said a blood requisition form signed by the treating doctor is required."),
  crossmatch_sample_required: yesNoUnknown("yes if staff said a patient blood sample is required for grouping and cross-matching."),
  replacement_donor_required: yesNoUnknown("yes if staff said the family must arrange a replacement donor."),
  processing_charge: text("Processing charge per unit exactly as staff stated. Empty string if not stated. Never estimate."),
  open_24x7: yesNoUnknown("yes if staff said blood is issued 24 hours a day, every day."),
  referral_or_restock: text("When staff expects stock, or another blood bank they suggested, in their words. Empty string if not stated."),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  evidence_quote: text("One short verbatim quote from blood bank staff that best supports stock_status. Empty string if staff said nothing relevant."),
  notes: text("Anything else operationally important, e.g. 'issue counter closes at 8 PM'. Empty string if none."),
});

export const BLOOD_RESERVE_RESULT_SCHEMA = strictObject({
  reserve_confirmed: yesNoUnknown("yes only if staff explicitly agreed to reserve the units under the given name."),
  reserve_name: text("The name the reservation is under, as confirmed by staff. Empty string if no reservation."),
  reserve_until: text("How long staff said they will keep the units, in their words. Empty string if not stated."),
  reference: text("Any reservation or reference number staff gave. Empty string if none."),
  documents_required: text("Documents staff said must be brought, e.g. 'requisition form signed by the doctor'. Empty string if not stated."),
  sample_required: yesNoUnknown("yes if staff said a patient blood sample must be sent for cross-matching."),
  replacement_donors_required: text("How many replacement donors staff said are needed, in their words. Empty string if none or not stated."),
  charge_per_unit: text("Charge per unit exactly as staff stated. Empty string if not stated. Never estimate."),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  evidence_quote: text("One short verbatim quote from staff that supports reserve_confirmed. Empty string if none."),
});

export const TRANSFER_RESULT_SCHEMA = strictObject({
  reached: {
    type: "string",
    enum: ["pharmacy_staff", "automated_system_only", "voicemail", "no_answer", "wrong_number", "unknown"],
    description:
      "Who the agent actually spoke with. pharmacy_staff only if a human at the pharmacy handled the request. automated_system_only if the call never got past a phone menu. voicemail if an answering machine took the call.",
  },
  prescription_found: yesNoUnknown("yes only if staff said they found the patient's unfilled prescription for this medication."),
  transfer_status: {
    type: "string",
    enum: ["will_transfer", "transferred", "receiving_pharmacy_must_request", "needs_prescriber", "declined", "unknown"],
    description:
      "transferred if staff said it was sent during the call. will_transfer if they agreed to send it. receiving_pharmacy_must_request if they said the new pharmacy has to request it. needs_prescriber if they said only the prescriber can send a new prescription. declined if they refused. unknown otherwise.",
  },
  expected_time: text("When staff said the transfer would happen, in their words. Empty string if not stated."),
  reference: text("Any transfer reference or confirmation staff gave. Empty string if none."),
  controlled_rule: text("Any rule staff cited about transferring a controlled medication, in their words. Empty string if none."),
  follow_up_needed: text("Anything the family or the receiving pharmacy still has to do. Empty string if nothing."),
  staff_name: text("First name of the staff member if they gave it. Empty string otherwise."),
  evidence_quote: text("One short verbatim quote from staff that supports transfer_status. Empty string if none."),
});

export const RESULT_SCHEMAS: Record<CallKind, Record<string, unknown>> = {
  inquiry: INQUIRY_RESULT_SCHEMA,
  hold: HOLD_RESULT_SCHEMA,
  prescriber: PRESCRIBER_RESULT_SCHEMA,
  transfer: TRANSFER_RESULT_SCHEMA,
  blood_inquiry: BLOOD_INQUIRY_RESULT_SCHEMA,
  blood_reserve: BLOOD_RESERVE_RESULT_SCHEMA,
};

const URGENCY: Record<Urgency, string> = { today: "Today", "48h": "Within 48 hours", week: "This week" };

const COMMON_GUARDRAILS: BriefSpec["guardrails"] = [
  { id: "payment", text: "Do not agree to purchases, payments, or insurance billing." },
  { id: "voicemail", text: "If you reach voicemail or an answering machine, end the call without leaving a message." },
  { id: "ai", text: "If anyone asks whether you are an AI, say yes." },
  { id: "time", text: "Keep the call under three minutes, stay polite, and thank them before ending." },
];

const MEDICATION_BOUNDARY: BriefSpec["guardrails"][number] = {
  id: "medical",
  text: "Do not give or ask for medical advice, diagnosis, or dosing guidance, and never suggest switching medications; that is the prescriber's decision.",
};

const BLOOD_BOUNDARY: BriefSpec["guardrails"][number] = {
  id: "medical",
  text: "Do not give or ask for medical advice, and never suggest a different blood group or component; that is the treating doctor's decision.",
};

export function speakable(e164: string | null): string {
  if (!e164) return "not available";
  if (e164.startsWith("+1") && e164.length === 12) {
    return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  }
  return e164.replace(/^\+/, "+ ").replace(/(\d{3})(?=\d)/g, "$1 ");
}

export function spokenBloodGroup(group: string): string {
  const letters = group.replace(/[+-]$/, "");
  return `${letters} ${group.endsWith("-") ? "negative" : "positive"} (${group})`;
}

export function bloodNeed(blood: BloodRequest): string {
  return `${blood.units} unit${blood.units === 1 ? "" : "s"} of ${spokenBloodGroup(blood.group)} ${BLOOD_COMPONENTS[blood.component]}`;
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/** Renders the natural-language CALL-E task from a structured brief. */
export function renderTask(spec: BriefSpec): string {
  const lines = [`Goal: ${spec.goal}`, "", "Details:"];
  for (const item of spec.target) lines.push(`- ${item.label}: ${item.value}`);
  for (const note of spec.notes) lines.push(`- ${note}`);
  lines.push("", "How to run the call:");
  let step = 1;
  lines.push(`${step++}. When a person answers, say: "${spec.opening}"`);
  for (const s of spec.steps) lines.push(`${step++}. ${s.detail}`);
  if (spec.ifYes.length) {
    lines.push(`${step++}. If yes or partly, ask: ${spec.ifYes.map((q, i) => `(${String.fromCharCode(97 + i)}) ${lowerFirst(q)}`).join(", ")}.`);
  }
  if (spec.ifNo.length) lines.push(`${step++}. If no: ${spec.ifNo.join(" ")}`);
  lines.push("", "Boundaries (must follow):", ...spec.guardrails.map((g) => `- ${g.text}`));
  return lines.join("\n");
}

export function inquiryBrief(med: Medication, facility: Facility): BriefSpec {
  const brand = med.brandNames.length ? ` (brand name: ${med.brandNames.slice(0, 2).join(" or ")})` : "";
  const alternatives = med.alternatives.length
    ? med.alternatives.slice(0, 3).join("; ")
    : "a generic version or a different strength of the same medication";
  return {
    kind: "inquiry",
    title: "Pharmacy stock check",
    goal: `Find out whether ${facility.name} can fill a specific prescription medication today. You are an AI assistant calling on behalf of a patient's family caregiver who is trying to locate this medication during a supply shortage.`,
    target: [
      { label: "Medication", value: `${med.name}${brand}` },
      { label: "Quantity needed", value: med.quantity },
      { label: "Needed by", value: URGENCY[med.urgency] },
    ],
    notes: med.controlled
      ? [
          `This is a controlled medication (DEA schedule ${med.deaSchedule ?? "II-V"}). Many pharmacies do not share controlled-substance inventory by phone. If they decline, accept it politely, do not push, and only ask whether the patient could check in person today.`,
        ]
      : [],
    opening: "Hi, this is an automated AI assistant calling on behalf of a patient's family. I have a quick stock question for the pharmacy. Do you have a moment?",
    steps: [
      {
        title: "Reach the pharmacy counter",
        detail:
          "If you reach a phone menu, choose the option for the pharmacy department or pharmacy staff. Avoid automated refill lines, store hours, and photo or front-store departments. If a menu asks for a prescription number, say you do not have one and ask for pharmacy staff.",
      },
      { title: "Ask the stock question", detail: `Ask: "Do you have ${med.name} in stock right now, and could you fill ${med.quantity} today?"` },
    ],
    ifYes: [
      "Roughly how much they have",
      "Whether they can set it aside for the patient, and for how long",
      "About how soon it could be ready",
      "The cash price without insurance, if they know it offhand",
      "Whether they can accept a prescription sent electronically by the prescriber",
    ],
    ifNo: [`Ask whether they have any of these in stock instead: ${alternatives}. Ask only about availability.`, "Then ask when they expect their next delivery."],
    guardrails: [
      {
        id: "privacy",
        text: "Do not share any patient personal information. If asked for a name or date of birth, say the caregiver will provide it directly when they call back or visit.",
      },
      MEDICATION_BOUNDARY,
      ...COMMON_GUARDRAILS,
    ],
  };
}

export function holdBrief(med: Medication, facility: Facility, inquiry: InquiryResult | null, contact: HoldContact): BriefSpec {
  const holdName = `${contact.firstName} ${contact.lastInitial}.`;
  const until = contact.holdUntil || "the end of the day";
  const earlier = inquiry?.staff_name ? ` (${inquiry.staff_name})` : "";
  const onHand = inquiry?.quantity_on_hand ? ` (${inquiry.quantity_on_hand})` : "";
  return {
    kind: "hold",
    title: "Hold request",
    goal: `Ask ${facility.name} to set a medication aside for a patient. Earlier today a pharmacy team member${earlier} told our assistant they have ${med.name} in stock${onHand}.`,
    target: [
      { label: "Medication", value: med.name },
      { label: "Quantity", value: med.quantity },
      { label: "Hold under", value: `"${holdName}"` },
      { label: "Hold until", value: until },
    ],
    notes: [],
    opening: `Hi, this is the automated AI assistant that called earlier about ${med.name} for a patient's family. I'm calling back to ask if you could set some aside.`,
    steps: [
      { title: "Request the hold", detail: `Ask them to hold ${med.quantity} of ${med.name} under the name "${holdName}" until ${until}.` },
      {
        title: "Confirm the next step",
        detail:
          "Ask what must happen before it can be filled: should the prescriber send an e-prescription directly to this pharmacy, or should an existing prescription be transferred? Ask what to bring at pickup.",
      },
      { title: "Get a reference", detail: "Ask for a hold reference or the staff member's first name, and the store number if they have one." },
      { title: "Read it back", detail: "Repeat back what they agreed to in one sentence, thank them, and end the call." },
    ],
    ifYes: [],
    ifNo: [],
    guardrails: [
      { id: "privacy", text: `Share only the name "${holdName}". Never share a date of birth, address, insurance details, or diagnosis.` },
      { id: "accept", text: "If they cannot hold without a prescription on file, accept that and record what they need instead." },
      MEDICATION_BOUNDARY,
      ...COMMON_GUARDRAILS,
    ],
  };
}

export function prescriberBrief(med: Medication, facility: Facility, hold: HoldResult | null, contact: PrescriberContact): BriefSpec {
  const store = hold?.store_identifier ? `, ${hold.store_identifier}` : "";
  const address = facility.address && facility.address !== "Address not listed" ? `, ${facility.address}` : "";
  const holdLine =
    hold?.hold_confirmed === "yes" ? ` The pharmacy is holding it under "${hold.hold_name}"${hold.hold_until ? ` until ${hold.hold_until}` : ""}.` : "";
  return {
    kind: "prescriber",
    title: "Prescription routing request",
    goal: `Ask the prescriber's office (${contact.practice}) to send a prescription for ${contact.patientFullName} to a pharmacy that has the medication in stock. The patient's usual pharmacy could not fill it because of a supply shortage.`,
    target: [
      { label: "Practice", value: `${contact.practice} (${contact.prescriberName})` },
      { label: "Medication", value: med.name },
      { label: "Send to", value: `${facility.name}${store}${address}, pharmacy phone ${speakable(facility.phone)}` },
    ],
    notes: [],
    opening: `Hi, this is an automated AI assistant calling on behalf of ${contact.patientFullName}. A prescription from ${contact.prescriberName} for ${med.name} could not be filled because of a shortage. We found a pharmacy that has it in stock right now.${holdLine}`,
    steps: [
      { title: "Ask for the e-prescription", detail: `Ask them to send the prescription electronically to: ${facility.name}${store}${address}, pharmacy phone ${speakable(facility.phone)}.` },
      { title: "Confirm timing", detail: "Ask when it will be sent and whether the prescriber needs to approve it first." },
      { title: "Accept their process", detail: "If the office requires the patient to call personally, accept that and record it." },
    ],
    ifYes: [],
    ifNo: [],
    guardrails: [
      {
        id: "privacy",
        text: `The patient consented to sharing their full name and date of birth (${contact.patientDob}) with this office only. Share them only when staff ask to verify identity.`,
      },
      { id: "medical", text: "Do not request any change to the medication, strength, or quantity. Only relay where the medication is available." },
      ...COMMON_GUARDRAILS,
    ],
  };
}

export function transferBrief(med: Medication, to: Facility, hold: HoldResult | null, contact: TransferContact): BriefSpec {
  const store = hold?.store_identifier ? `, ${hold.store_identifier}` : "";
  const address = to.address && to.address !== "Address not listed" ? `, ${to.address}` : "";
  const destination = `${to.name}${store}${address}, pharmacy phone ${speakable(to.phone)}`;
  const holdLine =
    hold?.hold_confirmed === "yes" ? ` It is being held there under "${hold.hold_name}"${hold.hold_until ? ` until ${hold.hold_until}` : ""}.` : "";
  return {
    kind: "transfer",
    title: "Prescription transfer request",
    goal: `Ask ${contact.fromPharmacy}, where ${contact.patientFullName}'s prescription for ${med.name} is waiting unfilled because of a supply shortage, to transfer it to ${to.name}, which has it in stock right now.${holdLine}`,
    target: [
      { label: "Transfer from", value: contact.fromPharmacy },
      { label: "Medication", value: med.name },
      { label: "Transfer to", value: destination },
    ],
    notes: med.controlled
      ? [
          `This is a controlled medication (DEA schedule ${med.deaSchedule ?? "II-V"}). Federal rules allow an unfilled electronic prescription for a schedule II-V medication to be transferred once between pharmacies at the patient's request, pharmacist to pharmacist. If staff say they cannot transfer it, accept that politely, do not push, and ask whether the prescriber needs to send a new prescription instead.`,
        ]
      : [],
    opening: `Hi, this is an automated AI assistant calling on behalf of ${contact.patientFullName}. Their prescription for ${med.name} is with your pharmacy but couldn't be filled because of the shortage. We found a pharmacy that has it in stock. Could you transfer the prescription there?`,
    steps: [
      {
        title: "Reach pharmacy staff",
        detail:
          "If you reach a phone menu, choose the option for pharmacy staff. Avoid automated refill lines. If a menu asks for a prescription number, say you do not have one and ask for pharmacy staff.",
      },
      { title: "Locate the prescription", detail: "Give the patient's full name and date of birth only when staff ask, so they can find the prescription." },
      { title: "Ask for the transfer", detail: `Ask them to transfer the unfilled prescription to: ${destination}.` },
      {
        title: "Follow their process",
        detail:
          "If they say the receiving pharmacy must request the transfer, or that the prescriber must send a new prescription, accept that and ask exactly what is needed.",
      },
      { title: "Confirm and read back", detail: "Ask when it will be sent and for a reference or the staff member's first name. Repeat back what they agreed to, thank them, and end the call." },
    ],
    ifYes: [],
    ifNo: [],
    guardrails: [
      {
        id: "privacy",
        text: `The patient consented to sharing their full name and date of birth (${contact.patientDob}) with this pharmacy only. Share them only when staff ask to locate the prescription.`,
      },
      { id: "medical", text: "Do not request any change to the medication, strength, or quantity. Only ask to move the existing prescription." },
      { id: "accept", text: "If they decline or need something else first, accept it and record what is needed." },
      ...COMMON_GUARDRAILS,
    ],
  };
}

export function bloodInquiryBrief(blood: BloodRequest, facility: Facility): BriefSpec {
  const need = bloodNeed(blood);
  return {
    kind: "blood_inquiry",
    title: "Blood availability check",
    goal: `Find out whether ${facility.name} can issue ${need} today for a patient admitted at ${blood.hospital}. You are an AI assistant calling on behalf of the patient's family.`,
    target: [
      { label: "Blood group", value: spokenBloodGroup(blood.group) },
      { label: "Component", value: BLOOD_COMPONENTS[blood.component] },
      { label: "Units needed", value: String(blood.units) },
      { label: "Patient admitted at", value: blood.hospital },
      { label: "Needed by", value: URGENCY[blood.urgency] },
    ],
    notes: [],
    opening: "Hi, this is an automated AI assistant calling on behalf of a patient's family. I have a quick question about blood availability. Is this the blood bank?",
    steps: [
      {
        title: "Reach the blood bank",
        detail: "If you reach a phone menu or a hospital switchboard, ask for the blood bank, blood centre, or blood issue counter.",
      },
      { title: "Ask about availability", detail: `Ask: "Do you currently have ${need} available, and could they be issued today?"` },
    ],
    ifYes: [
      "How many units they have right now",
      "Whether they can reserve the units for this patient, and for how long",
      "Whether a requisition form signed by the treating doctor is required",
      "Whether a patient blood sample is needed for cross-matching",
      "Whether the family must arrange a replacement donor",
      "The processing charge per unit",
      "Whether they issue blood 24 hours a day",
    ],
    ifNo: ["Ask when they expect to have it, or which nearby blood bank they would suggest. Ask only about this blood group and component."],
    guardrails: [
      {
        id: "privacy",
        text: "Do not share the patient's name or any personal details. If asked, say the family or the hospital will provide them directly.",
      },
      BLOOD_BOUNDARY,
      ...COMMON_GUARDRAILS,
    ],
  };
}

export function bloodReserveBrief(blood: BloodRequest, facility: Facility, inquiry: BloodInquiryResult | null, contact: HoldContact): BriefSpec {
  const need = bloodNeed(blood);
  const holdName = `${contact.firstName} ${contact.lastInitial}.`;
  const until = contact.holdUntil || "the end of the day";
  const earlier = inquiry?.staff_name ? ` (${inquiry.staff_name})` : "";
  const units = inquiry?.units_available ? ` (${inquiry.units_available})` : "";
  return {
    kind: "blood_reserve",
    title: "Reservation request",
    goal: `Ask ${facility.name} to reserve ${need} for a patient admitted at ${blood.hospital}. Earlier a staff member${earlier} told our assistant they have it available${units}.`,
    target: [
      { label: "Reserve", value: need },
      { label: "Under the name", value: `"${holdName}"` },
      { label: "Patient admitted at", value: blood.hospital },
      { label: "Keep until", value: until },
    ],
    notes: [],
    opening: `Hi, this is the automated AI assistant that called earlier about ${spokenBloodGroup(blood.group)} ${BLOOD_COMPONENTS[blood.component]} for a patient's family. I'm calling back to ask if you could reserve it.`,
    steps: [
      { title: "Request the reservation", detail: `Ask them to reserve ${need} under the name "${holdName}" for a patient at ${blood.hospital}, until ${until}.` },
      {
        title: "Confirm requirements",
        detail: "Ask exactly which documents to bring, whether a patient sample must be sent for cross-matching, how many replacement donors are needed, and the charge per unit.",
      },
      { title: "Get a reference", detail: "Ask for a reservation reference or the staff member's first name." },
      { title: "Read it back", detail: "Repeat back what they agreed to in one sentence, thank them, and end the call." },
    ],
    ifYes: [],
    ifNo: [],
    guardrails: [
      { id: "privacy", text: `Share only the name "${holdName}" and the hospital name. Never share a date of birth, address, or diagnosis.` },
      { id: "accept", text: "If they cannot reserve without a requisition or sample, accept that and record what they need instead." },
      BLOOD_BOUNDARY,
      ...COMMON_GUARDRAILS,
    ],
  };
}

export const buildInquiryTask = (med: Medication, facility: Facility) => renderTask(inquiryBrief(med, facility));
export const buildHoldTask = (med: Medication, facility: Facility, inquiry: InquiryResult | null, contact: HoldContact) =>
  renderTask(holdBrief(med, facility, inquiry, contact));
export const buildPrescriberTask = (med: Medication, facility: Facility, hold: HoldResult | null, contact: PrescriberContact) =>
  renderTask(prescriberBrief(med, facility, hold, contact));
export const buildTransferTask = (med: Medication, to: Facility, hold: HoldResult | null, contact: TransferContact) =>
  renderTask(transferBrief(med, to, hold, contact));
