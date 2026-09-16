// Encrypted CALL-E stand-in for the no-call default. A simulated call keeps its scenario portable
// without exposing medication or identity data in its ID, and returns the same shape as a live SDK
// call. Every simulated call is flagged `simulated: true` and marked with a blue dot in the UI.
import { decodeSimulationSpec, encodeSimulationSpec } from "./simulation-token";
import type { CallAttemptView, CallEventView, CallKind, CallView, TranscriptTurn } from "./types";

const PREFIX = "call_pb_";
const SPEED = 3; // simulated call-seconds per real second
const QUEUE_MS = 1200;
const DIAL_MS = 2800;
const FINALIZE_MS = 2600;

export type ScenarioId =
  | "in_stock_hold"
  | "out_with_alternative"
  | "partial"
  | "refused"
  | "voicemail"
  | "no_answer"
  | "in_stock_no_hold"
  | "hold_confirmed"
  | "prescriber_accepted"
  | "blood_available_reserve"
  | "blood_partial"
  | "blood_unavailable_referral"
  | "blood_voicemail"
  | "blood_reserve_confirmed"
  | "transfer_sent"
  | "transfer_controlled_once";

interface SimSpec {
  v: 1;
  k: CallKind;
  s: ScenarioId;
  t: number; // start, epoch ms
  p: string; // pharmacy (or office) name
  m: string; // medication
  q: string; // quantity
  a: string; // alternative to ask about
  n: string; // hold name
  f: string; // staff first name from the inquiry
}

type Line = [at: number, speaker: TranscriptTurn["speaker"], text: string];

interface Script {
  lines: Line[];
  ivrAt?: number;
  holdMusic?: [number, number];
  failAfterMs?: number;
  failureCode?: string;
  failureMessage?: string;
  result: Record<string, unknown> | null;
  summary: string;
  taskCompleted: boolean;
  confidence: number;
  evidence: string[];
}

const BLANK_INQUIRY = {
  reached: "unknown",
  stock_status: "unknown",
  can_fill_today: "unknown",
  quantity_on_hand: "",
  alternative_available: "not_discussed",
  alternative_details: "",
  hold_offered: "unknown",
  hold_duration_hours: 0,
  ready_time: "",
  cash_price: "",
  restock_eta: "",
  transfer_accepted: "unknown",
  staff_name: "",
  evidence_quote: "",
  notes: "",
};

const BLANK_BLOOD = {
  reached: "unknown",
  stock_status: "unknown",
  units_available: "",
  can_issue_today: "unknown",
  reserve_offered: "unknown",
  reserve_duration_hours: 0,
  requisition_required: "unknown",
  crossmatch_sample_required: "unknown",
  replacement_donor_required: "unknown",
  processing_charge: "",
  open_24x7: "unknown",
  referral_or_restock: "",
  staff_name: "",
  evidence_quote: "",
  notes: "",
};

const askBlood = (s: SimSpec) =>
  `Hi, this is an automated AI assistant calling on behalf of a patient's family. Do you currently have ${s.m} available, and could they be issued today?`;

const ask = (s: SimSpec) =>
  `Hi, this is an automated AI assistant calling on behalf of a patient's family. Quick stock question: do you have ${s.m} in stock right now, and could you fill ${s.q} today?`;

const SCRIPTS: Record<ScenarioId, (s: SimSpec) => Script> = {
  in_stock_hold: (s) => ({
    ivrAt: 7,
    lines: [
      [0, "user", `Thank you for calling ${s.p}. For the pharmacy, press 1. For store hours, press 2. For all other departments, press 3.`],
      [7, "bot", "⌨ Pressed 1 · pharmacy department"],
      [11, "user", "Pharmacy, this is Dana. How can I help you?"],
      [14, "bot", ask(s)],
      [27, "user", "Let me check the shelf… Yes, we have two bottles right here. We could fill that today."],
      [35, "bot", "That's great news. Could you set it aside for the patient, and for how long?"],
      [40, "user", "Sure, we can hold it for twenty-four hours."],
      [45, "bot", "Thank you. Roughly how soon could it be ready, and do you know the cash price without insurance?"],
      [51, "user", "About thirty minutes once the prescription comes in. The cash price depends on the manufacturer, so I'd have to look it up."],
      [59, "bot", "And can you accept an e-prescription sent directly from the prescriber?"],
      [63, "user", "Yes, they can send it straight to this store."],
      [67, "bot", "Perfect. Thank you so much, Dana. Have a great day."],
      [71, "user", "You too. Bye now."],
    ],
    result: {
      ...BLANK_INQUIRY,
      reached: "pharmacy_staff",
      stock_status: "in_stock",
      can_fill_today: "yes",
      quantity_on_hand: "two bottles",
      hold_offered: "yes",
      hold_duration_hours: 24,
      ready_time: "About 30 minutes after the prescription arrives",
      transfer_accepted: "yes",
      staff_name: "Dana",
      evidence_quote: "Yes, we have two bottles right here. We could fill that today.",
    },
    summary: `${s.p} has it in stock (two bottles), can fill today, and will hold it for about 24 hours.`,
    taskCompleted: true,
    confidence: 0.94,
    evidence: ["Staff confirmed two bottles on the shelf.", "Staff agreed to a 24-hour hold.", "Staff accepts e-prescriptions."],
  }),

  out_with_alternative: (s) => ({
    holdMusic: [2, 26],
    lines: [
      [0, "user", `${s.p}, please hold.`],
      [2, "unknown", "♪ Hold music · 24 seconds"],
      [26, "user", "Thanks for holding, this is Marcus in the pharmacy."],
      [29, "bot", ask(s)],
      [40, "user", "Unfortunately no. We've been on backorder for that one for about two weeks."],
      [47, "bot", `Understood. Do you have ${s.a} in stock instead?`],
      [55, "user", "We do have the lower strength, a few bottles of that."],
      [61, "bot", "Thank you. When do you expect your next delivery of the original one?"],
      [66, "user", "Possibly Thursday, but I can't promise."],
      [71, "bot", "That's really helpful. Thanks for your time, Marcus."],
    ],
    result: {
      ...BLANK_INQUIRY,
      reached: "pharmacy_staff",
      stock_status: "out_of_stock",
      can_fill_today: "no",
      alternative_available: "different_strength",
      alternative_details: `${s.a} (a few bottles)`,
      hold_offered: "no",
      restock_eta: "Possibly Thursday (not guaranteed)",
      staff_name: "Marcus",
      evidence_quote: "Unfortunately no. We've been on backorder for that one for about two weeks.",
      notes: "A different strength is in stock; switching strength is the prescriber's decision.",
    },
    summary: `${s.p} is out of stock (backordered ~2 weeks). A different strength is available; restock possibly Thursday.`,
    taskCompleted: true,
    confidence: 0.9,
    evidence: ["Staff said the item is on backorder.", "Staff said a lower strength is in stock."],
  }),

  partial: (s) => ({
    lines: [
      [0, "user", `${s.p} pharmacy, this is Luis.`],
      [3, "bot", ask(s)],
      [14, "user", "We have some, but only one bottle, not the full amount."],
      [20, "bot", "Could you fill that partial amount today and hold it?"],
      [25, "user", "Yes, we can do a partial fill today and owe the rest. I can hold it about four hours."],
      [33, "bot", "Thank you. When would the rest arrive?"],
      [37, "user", "Our next order comes in tomorrow morning."],
      [42, "bot", "Great, thank you Luis."],
    ],
    result: {
      ...BLANK_INQUIRY,
      reached: "pharmacy_staff",
      stock_status: "partial",
      can_fill_today: "yes",
      quantity_on_hand: "one bottle (less than requested)",
      hold_offered: "yes",
      hold_duration_hours: 4,
      ready_time: "Today (partial fill)",
      restock_eta: "Tomorrow morning",
      staff_name: "Luis",
      evidence_quote: "We have some, but only one bottle, not the full amount.",
      notes: "Partial fill today; remainder owed tomorrow.",
    },
    summary: `${s.p} can partially fill today (one bottle) and hold it ~4 hours; the rest arrives tomorrow.`,
    taskCompleted: true,
    confidence: 0.88,
    evidence: ["Staff said only one bottle is on hand.", "Staff offered a partial fill and a 4-hour hold."],
  }),

  refused: (s) => ({
    ivrAt: 5,
    lines: [
      [0, "user", `Thank you for calling ${s.p}. For pharmacy, press 1.`],
      [5, "bot", "⌨ Pressed 1 · pharmacy"],
      [9, "user", "Pharmacy, this is Priya."],
      [12, "bot", ask(s)],
      [23, "user", "I'm sorry, we can't give out inventory for controlled medications over the phone. The patient would need to come in, or have the doctor send the prescription and we'll let them know."],
      [35, "bot", "Understood, thank you. Is the pharmacy open today if the patient checks in person?"],
      [41, "user", "Yes, we're open until nine tonight."],
      [45, "bot", "Thank you, Priya."],
    ],
    result: {
      ...BLANK_INQUIRY,
      reached: "pharmacy_staff",
      stock_status: "refused_to_disclose",
      transfer_accepted: "yes",
      staff_name: "Priya",
      evidence_quote: "We can't give out inventory for controlled medications over the phone.",
      notes: "Open until 9 PM tonight; the patient may check in person.",
    },
    summary: `${s.p} does not disclose controlled-substance inventory by phone. Open until 9 PM; the prescriber can send the prescription.`,
    taskCompleted: true,
    confidence: 0.91,
    evidence: ["Staff declined to share controlled-substance inventory by phone."],
  }),

  voicemail: (s) => ({
    lines: [
      [0, "user", `You've reached ${s.p}. Our pharmacy is currently closed. Please call back during business hours, or leave a message after the tone.`],
      [9, "bot", "Voicemail detected. Ended the call without leaving a message."],
    ],
    result: { ...BLANK_INQUIRY, reached: "voicemail", notes: "Voicemail: the pharmacy counter was closed at the time of the call." },
    summary: "Reached voicemail; the pharmacy counter appears closed. No stock information.",
    taskCompleted: false,
    confidence: 0.9,
    evidence: ["A recorded greeting said the pharmacy is closed."],
  }),

  no_answer: () => ({
    lines: [],
    failAfterMs: 9000,
    failureCode: "no_answer",
    failureMessage: "The call rang out with no answer.",
    result: null,
    summary: "No one answered.",
    taskCompleted: false,
    confidence: 0.95,
    evidence: [],
  }),

  in_stock_no_hold: (s) => ({
    lines: [
      [0, "user", `${s.p}, pharmacy counter, this is Sam.`],
      [3, "bot", ask(s)],
      [14, "user", "Yeah, we've got it. Plenty on the shelf."],
      [19, "bot", "Great. Could you set some aside for the patient?"],
      [23, "user", "We don't hold without a prescription on file, sorry. But we have plenty, it shouldn't be a problem."],
      [31, "bot", "Understood. Could you accept an e-prescription from the doctor?"],
      [35, "user", "Sure, have them send it over."],
      [39, "bot", "Thank you, Sam."],
    ],
    result: {
      ...BLANK_INQUIRY,
      reached: "pharmacy_staff",
      stock_status: "in_stock",
      can_fill_today: "yes",
      quantity_on_hand: "plenty on the shelf",
      hold_offered: "no",
      transfer_accepted: "yes",
      staff_name: "Sam",
      evidence_quote: "Yeah, we've got it. Plenty on the shelf.",
      notes: "No holds without a prescription on file.",
    },
    summary: `${s.p} has plenty in stock and accepts e-prescriptions, but does not hold without a prescription on file.`,
    taskCompleted: true,
    confidence: 0.89,
    evidence: ["Staff said there is plenty on the shelf."],
  }),

  hold_confirmed: (s) => ({
    lines: [
      [0, "user", `${s.p} pharmacy, this is ${s.f}.`],
      [3, "bot", `Hi ${s.f}, this is the automated AI assistant that called earlier about ${s.m} for a patient's family. Could you set ${s.q} aside under the name ${s.n}?`],
      [15, "user", "Sure, I'll put it aside under that name. We can keep it until tomorrow evening."],
      [22, "bot", "Thank you. What does the patient need to do next? Should the prescriber send an e-prescription here?"],
      [28, "user", "Yes, have the doctor e-prescribe it to us. We're store number 2214. They'll just need a photo ID at pickup."],
      [37, "bot", "Is there a reference for the hold?"],
      [40, "user", "Just mention hold H-4821."],
      [44, "bot", `Perfect. To confirm: ${s.q} held under ${s.n} until tomorrow evening, reference H-4821, prescriber e-prescribes to store 2214. Thank you!`],
      [55, "user", "You got it."],
    ],
    result: {
      hold_confirmed: "yes",
      hold_name: s.n,
      hold_until: "Tomorrow evening",
      reference: "H-4821",
      next_step_required: "e_prescription_to_this_pharmacy",
      pickup_requirements: "Photo ID at pickup",
      store_identifier: "Store #2214",
      staff_name: s.f,
      evidence_quote: "I'll put it aside under that name. We can keep it until tomorrow evening.",
    },
    summary: `Hold confirmed under ${s.n} until tomorrow evening (ref H-4821). Prescriber should e-prescribe to store #2214.`,
    taskCompleted: true,
    confidence: 0.95,
    evidence: ["Staff agreed to the hold and gave reference H-4821."],
  }),

  prescriber_accepted: (s) => ({
    lines: [
      [0, "user", `${s.p}, this is Jordan at the front desk.`],
      [3, "bot", `Hi Jordan, I'm an automated AI assistant calling on behalf of a patient. Their prescription for ${s.m} couldn't be filled because of a shortage. We found a pharmacy that has it in stock and is holding it. Could the prescriber send the prescription there?`],
      [20, "user", "Sure. Can I get the patient's name and date of birth?"],
      [24, "bot", "Shared the patient's name and date of birth (consented, this office only)."],
      [30, "user", "Got it, I see the chart. Which pharmacy?"],
      [33, "bot", "I'll give you the pharmacy name, store number, address, and phone number."],
      [42, "user", "Perfect. I'll send it to the doctor to sign. It should go out within the hour."],
      [49, "bot", "Thank you so much, Jordan."],
    ],
    result: {
      request_status: "accepted",
      expected_send_time: "Within the hour",
      staff_name: "Jordan",
      follow_up_needed: "",
      evidence_quote: "I'll send it to the doctor to sign. It should go out within the hour.",
    },
    summary: "The prescriber's office will send the e-prescription to the pharmacy within the hour.",
    taskCompleted: true,
    confidence: 0.92,
    evidence: ["Front desk agreed to route the prescription after the prescriber signs."],
  }),

  blood_available_reserve: (s) => ({
    ivrAt: 6,
    lines: [
      [0, "user", `Welcome to ${s.p}. For the blood bank, press 3. For all other enquiries, please stay on the line.`],
      [6, "bot", "⌨ Pressed 3 · blood bank"],
      [10, "user", "Blood bank, Ravi speaking."],
      [13, "bot", askBlood(s)],
      [26, "user", `Let me check the register… yes, we can give you ${s.q} right now.`],
      [33, "bot", "That's a relief. Could you reserve them for the patient, and for how long?"],
      [38, "user", "We can keep them aside for about six hours once the request comes in."],
      [44, "bot", "Thank you. What do you need to issue them?"],
      [48, "user", "A requisition form signed by the treating doctor, and a patient sample for cross-matching. We also ask the family to arrange one replacement donor."],
      [60, "bot", "Understood. What is the processing charge, and do you issue at night?"],
      [65, "user", "It's the standard government rate, the counter will confirm it. And yes, we're open 24 hours."],
      [73, "bot", "Thank you so much, Ravi."],
    ],
    result: {
      ...BLANK_BLOOD,
      reached: "facility_staff",
      stock_status: "in_stock",
      units_available: s.q,
      can_issue_today: "yes",
      reserve_offered: "yes",
      reserve_duration_hours: 6,
      requisition_required: "yes",
      crossmatch_sample_required: "yes",
      replacement_donor_required: "yes",
      processing_charge: "Standard government rate (confirmed at the counter)",
      open_24x7: "yes",
      staff_name: "Ravi",
      evidence_quote: `Yes, we can give you ${s.q} right now.`,
      notes: "Family asked to arrange one replacement donor.",
    },
    summary: `${s.p} can issue ${s.q} today and will reserve them for about six hours; needs a signed requisition, a patient sample, and one replacement donor.`,
    taskCompleted: true,
    confidence: 0.93,
    evidence: ["Staff confirmed the requested units are available.", "Staff agreed to a six-hour reservation."],
  }),

  blood_partial: (s) => ({
    lines: [
      [0, "user", `${s.p} blood centre, this is Meena.`],
      [3, "bot", askBlood(s)],
      [14, "user", "We only have one unit of that right now, not the full amount."],
      [20, "bot", "Could you keep that one unit aside, and when would more be available?"],
      [25, "user", "I can keep it for about four hours. We're expecting donations from a camp tomorrow morning."],
      [33, "bot", "Thank you, Meena."],
    ],
    result: {
      ...BLANK_BLOOD,
      reached: "facility_staff",
      stock_status: "partial",
      units_available: "one unit",
      can_issue_today: "yes",
      reserve_offered: "yes",
      reserve_duration_hours: 4,
      referral_or_restock: "Donation camp expected tomorrow morning",
      staff_name: "Meena",
      evidence_quote: "We only have one unit of that right now, not the full amount.",
    },
    summary: `${s.p} has one unit (fewer than requested) and can hold it about four hours; more expected after tomorrow's camp.`,
    taskCompleted: true,
    confidence: 0.88,
    evidence: ["Staff said only one unit is available."],
  }),

  blood_unavailable_referral: (s) => ({
    holdMusic: [2, 20],
    lines: [
      [0, "user", `${s.p}, please hold.`],
      [2, "unknown", "♪ Hold music · 18 seconds"],
      [20, "user", "Blood bank, this is Arjun."],
      [23, "bot", askBlood(s)],
      [33, "user", "Sorry, we don't have any of that group right now. The regional blood centre usually has more stock, you could try them."],
      [42, "bot", "Thank you. Do you know when you might get stock?"],
      [46, "user", "Hard to say, maybe in a couple of days."],
      [50, "bot", "Thanks for your help, Arjun."],
    ],
    result: {
      ...BLANK_BLOOD,
      reached: "facility_staff",
      stock_status: "out_of_stock",
      can_issue_today: "no",
      reserve_offered: "no",
      referral_or_restock: "Suggested the regional blood centre; own stock maybe in a couple of days",
      staff_name: "Arjun",
      evidence_quote: "Sorry, we don't have any of that group right now.",
    },
    summary: `${s.p} has none available and suggested the regional blood centre.`,
    taskCompleted: true,
    confidence: 0.9,
    evidence: ["Staff said the group is unavailable.", "Staff referred to the regional blood centre."],
  }),

  blood_voicemail: (s) => ({
    lines: [
      [0, "user", `You've reached ${s.p}. We're unable to take your call right now. Please call back, or leave a message after the tone.`],
      [8, "bot", "Voicemail detected. Ended the call without leaving a message."],
    ],
    result: { ...BLANK_BLOOD, reached: "voicemail", notes: "Voicemail: no one at the blood bank answered." },
    summary: "Reached voicemail. No availability information.",
    taskCompleted: false,
    confidence: 0.9,
    evidence: ["A recorded greeting answered the call."],
  }),

  blood_reserve_confirmed: (s) => ({
    lines: [
      [0, "user", `${s.p} blood bank, ${s.f} here.`],
      [3, "bot", `Hi ${s.f}, this is the automated AI assistant that called earlier for a patient's family. Could you reserve ${s.m} under the name ${s.n}, for a patient at ${s.a}?`],
      [16, "user", "Yes, I'll keep them aside under that name until 10 PM tonight."],
      [23, "bot", "Thank you. What exactly should the family bring?"],
      [27, "user", "The requisition form signed by the doctor, and send a fresh patient sample for cross-matching. One replacement donor, please."],
      [38, "bot", "And the charge per unit?"],
      [41, "user", "Standard government rate, the counter will confirm."],
      [45, "bot", "Is there a reference for the reservation?"],
      [48, "user", "Reservation R-2207."],
      [52, "bot", `To confirm: reserved under ${s.n} until 10 PM tonight, reference R-2207, bring the signed requisition and a patient sample, and one replacement donor. Thank you!`],
    ],
    result: {
      reserve_confirmed: "yes",
      reserve_name: s.n,
      reserve_until: "10 PM tonight",
      reference: "R-2207",
      documents_required: "Requisition form signed by the treating doctor",
      sample_required: "yes",
      replacement_donors_required: "One replacement donor",
      charge_per_unit: "Standard government rate (counter will confirm)",
      staff_name: s.f,
      evidence_quote: "Yes, I'll keep them aside under that name until 10 PM tonight.",
    },
    summary: `Reserved under ${s.n} until 10 PM tonight (ref R-2207). Bring the signed requisition, a patient sample, and one replacement donor.`,
    taskCompleted: true,
    confidence: 0.95,
    evidence: ["Staff agreed to the reservation and gave reference R-2207."],
  }),

  // For transfer calls, `p` is the patient's current pharmacy and `a` the pharmacy that has stock.
  transfer_sent: (s) => ({
    ivrAt: 5,
    lines: [
      [0, "user", `Thank you for calling ${s.p}. For the pharmacy, press 1.`],
      [5, "bot", "⌨ Pressed 1 · pharmacy"],
      [8, "user", "Pharmacy, this is Kim."],
      [11, "bot", `Hi Kim, I'm an automated AI assistant calling on behalf of a patient. Their prescription for ${s.m} is with your pharmacy but couldn't be filled because of the shortage. ${s.a} has it in stock. Could you transfer the prescription there?`],
      [27, "user", "Sure, I can do that. What's the patient's name and date of birth?"],
      [32, "bot", "Shared the patient's name and date of birth (consented, this pharmacy only)."],
      [38, "user", "Okay, I see it. It hasn't been filled. What's their number?"],
      [42, "bot", `Here is ${s.a}'s pharmacy phone number and store number.`],
      [49, "user", "Got it. I'll call them now and transfer it over. It should be in their system within the hour."],
      [57, "bot", "Thank you. Is there a reference I can give the family?"],
      [61, "user", "Tell them transfer T-5530, and it was Kim."],
      [65, "bot", `Perfect. To confirm: the prescription goes to ${s.a} within the hour, reference T-5530. Thank you, Kim!`],
    ],
    result: {
      reached: "pharmacy_staff",
      prescription_found: "yes",
      transfer_status: "will_transfer",
      expected_time: "Within the hour",
      reference: "T-5530",
      controlled_rule: "",
      follow_up_needed: "",
      staff_name: "Kim",
      evidence_quote: "I'll call them now and transfer it over. It should be in their system within the hour.",
    },
    summary: `${s.p} will transfer the prescription to ${s.a} within the hour (ref T-5530).`,
    taskCompleted: true,
    confidence: 0.94,
    evidence: ["Staff found the unfilled prescription.", "Staff agreed to transfer it within the hour."],
  }),

  transfer_controlled_once: (s) => ({
    lines: [
      [0, "user", `${s.p} pharmacy, Omar speaking.`],
      [3, "bot", `Hi Omar, I'm an automated AI assistant calling on behalf of a patient. Their prescription for ${s.m} is with your pharmacy but couldn't be filled because of the shortage. ${s.a} has it in stock. Could you transfer the prescription there?`],
      [19, "user", "Can I get the patient's name and date of birth?"],
      [23, "bot", "Shared the patient's name and date of birth (consented, this pharmacy only)."],
      [29, "user", "I see it. It's a schedule two e-prescription and it hasn't been filled, so we can transfer it once. It has to go pharmacist to pharmacist, so I'll call their pharmacist."],
      [44, "bot", "That's very helpful. When will you call them?"],
      [47, "user", "This afternoon, before three."],
      [51, "bot", `Thank you, Omar. To confirm: a one-time transfer of the e-prescription to ${s.a}, pharmacist to pharmacist, this afternoon before three.`],
    ],
    result: {
      reached: "pharmacy_staff",
      prescription_found: "yes",
      transfer_status: "will_transfer",
      expected_time: "This afternoon, before 3 PM",
      reference: "",
      controlled_rule: "Unfilled schedule II e-prescription: one-time transfer, pharmacist to pharmacist",
      follow_up_needed: `${s.a}'s pharmacist takes the transfer call from Omar.`,
      staff_name: "Omar",
      evidence_quote: "It hasn't been filled, so we can transfer it once. It has to go pharmacist to pharmacist.",
    },
    summary: `${s.p} will make a one-time, pharmacist-to-pharmacist transfer of the controlled e-prescription to ${s.a} this afternoon.`,
    taskCompleted: true,
    confidence: 0.92,
    evidence: ["Staff confirmed the e-prescription is unfilled.", "Staff cited the one-time transfer rule for schedule II."],
  }),
};

const INQUIRY_ORDER: ScenarioId[] = ["out_with_alternative", "in_stock_hold", "voicemail", "partial", "in_stock_no_hold", "no_answer"];
const CONTROLLED_ORDER: ScenarioId[] = ["refused", "in_stock_hold", "no_answer", "refused", "partial", "voicemail"];

const BLOOD_ORDER: ScenarioId[] = [
  "blood_unavailable_referral",
  "blood_available_reserve",
  "no_answer",
  "blood_partial",
  "blood_voicemail",
  "blood_available_reserve",
];

function pickScenario(kind: CallKind, seed: number, controlled: boolean): ScenarioId {
  if (kind === "hold") return "hold_confirmed";
  if (kind === "prescriber") return "prescriber_accepted";
  if (kind === "transfer") return controlled ? "transfer_controlled_once" : "transfer_sent";
  if (kind === "blood_reserve") return "blood_reserve_confirmed";
  if (kind === "blood_inquiry") return BLOOD_ORDER[seed % BLOOD_ORDER.length];
  const order = controlled ? CONTROLLED_ORDER : INQUIRY_ORDER;
  return order[seed % order.length];
}

export function isSimulatedId(id: string): boolean {
  return id.startsWith(PREFIX);
}

function decode(id: string): SimSpec | null {
  const spec = decodeSimulationSpec<SimSpec>(PREFIX, id);
  return spec?.v === 1 && spec.s in SCRIPTS ? spec : null;
}

function timeline(script: Script) {
  if (script.failAfterMs != null) {
    const endAt = QUEUE_MS + script.failAfterMs;
    return { connectAt: null, endAt, doneAt: endAt + 600 };
  }
  const connectAt = QUEUE_MS + DIAL_MS;
  const lastLine = script.lines.at(-1)?.[0] ?? 0;
  const endAt = connectAt + ((lastLine + 3) * 1000) / SPEED;
  return { connectAt, endAt, doneAt: endAt + FINALIZE_MS };
}

function project(id: string, spec: SimSpec, now: number): CallView {
  const script = SCRIPTS[spec.s](spec);
  const { connectAt, endAt, doneAt } = timeline(script);
  const elapsed = Math.max(0, now - spec.t);
  const iso = (ms: number) => new Date(spec.t + ms).toISOString();
  const failed = script.failAfterMs != null;
  const done = elapsed >= doneAt;

  let attemptStatus: CallAttemptView["status"];
  if (elapsed < QUEUE_MS) attemptStatus = "queued";
  else if (connectAt === null ? elapsed < endAt : elapsed < connectAt) attemptStatus = "dialing";
  else if (elapsed < endAt) attemptStatus = "in_progress";
  else attemptStatus = failed ? "failed" : "completed";

  const callSeconds = connectAt === null ? 0 : Math.max(0, ((Math.min(elapsed, endAt) - connectAt) * SPEED) / 1000);
  const turns: TranscriptTurn[] =
    connectAt === null || elapsed < connectAt
      ? []
      : script.lines
          .filter(([at]) => at <= callSeconds)
          .map(([at, speaker, text]) => ({ offsetSeconds: at, speaker, text }));

  const endedFailure = failed && elapsed >= endAt;
  return {
    id,
    status: elapsed < QUEUE_MS ? "queued" : done ? (failed ? "failed" : "completed") : "in_progress",
    structuredResult: done ? script.result : null,
    summary: done ? script.summary : null,
    taskCompleted: done ? script.taskCompleted : null,
    completionConfidence: done
      ? { score: script.confidence, label: script.confidence >= 0.85 ? "high" : script.confidence >= 0.6 ? "medium" : "low" }
      : null,
    evidence: done ? script.evidence : [],
    metadata: { app: "pharmabridge", kind: spec.k, scenario: spec.s, simulated: true },
    failureCode: done && failed ? (script.failureCode ?? "call_failed") : null,
    failureMessage: done && failed ? (script.failureMessage ?? null) : null,
    createdAt: iso(0),
    completedAt: done ? iso(doneAt) : null,
    attempts: [
      {
        id: `att_sim_${spec.t.toString(36)}`,
        status: attemptStatus,
        startedAt: elapsed >= QUEUE_MS ? iso(QUEUE_MS) : null,
        completedAt: elapsed >= endAt ? iso(endAt) : null,
        summary: done ? script.summary : null,
        transcriptTurns: turns,
        providerCallId: null,
        failureCode: endedFailure ? (script.failureCode ?? null) : null,
        failureMessage: endedFailure ? (script.failureMessage ?? null) : null,
      },
    ],
    simulated: true,
  };
}

export interface SimulatedCallInput {
  kind: CallKind;
  seed: number;
  controlled: boolean;
  name: string;
  medication: string;
  quantity: string;
  alternative: string;
  holdName: string;
  staffName: string;
}

export function createSimulatedCall(input: SimulatedCallInput): CallView {
  const spec: SimSpec = {
    v: 1,
    k: input.kind,
    s: pickScenario(input.kind, input.seed, input.controlled),
    t: Date.now(),
    p: input.name,
    m: input.medication,
    q: input.quantity,
    a: input.alternative,
    n: input.holdName,
    f: input.staffName,
  };
  const id = encodeSimulationSpec(PREFIX, spec);
  return project(id, spec, spec.t);
}

export function getSimulatedCall(id: string, now = Date.now()): CallView | null {
  const spec = decode(id);
  return spec ? project(id, spec, now) : null;
}

export function getSimulatedEvents(id: string, now = Date.now()): CallEventView[] | null {
  const spec = decode(id);
  if (!spec) return null;
  const script = SCRIPTS[spec.s](spec);
  const { connectAt, endAt, doneAt } = timeline(script);
  const failed = script.failAfterMs != null;
  const events: Array<[number, string, CallEventView["level"], string]> = [
    [0, "call.created", "info", "Call task accepted by CALL-E."],
    [QUEUE_MS, "attempt.dialing", "info", "Dialing."],
  ];
  if (connectAt !== null) {
    events.push([connectAt, "call.connected", "info", "Call connected."]);
    if (script.ivrAt != null) {
      events.push([connectAt + 400, "ivr.menu_detected", "info", "Phone menu detected; listening for the pharmacy option."]);
      events.push([connectAt + (script.ivrAt * 1000) / SPEED, "ivr.dtmf_sent", "info", "Sent a keypad tone to reach pharmacy staff."]);
    }
    if (script.holdMusic) {
      events.push([connectAt + (script.holdMusic[0] * 1000) / SPEED, "call.on_hold", "info", "Placed on hold; waiting."]);
      events.push([connectAt + (script.holdMusic[1] * 1000) / SPEED, "call.hold_ended", "info", "A person picked up."]);
    }
    events.push([endAt, "call.ended", "info", "Call ended; extracting the structured result."]);
  }
  events.push([
    doneAt,
    failed ? "call.failed" : "call.completed",
    failed ? "warning" : "info",
    failed ? (script.failureMessage ?? "Call failed.") : "Structured result validated against the schema.",
  ]);

  const elapsed = now - spec.t;
  return events
    .filter(([at]) => at <= elapsed)
    .sort((a, b) => a[0] - b[0])
    .map(([at, type, level, message], i) => ({ id: `evt_sim_${i}`, type, level, message, createdAt: new Date(spec.t + at).toISOString() }));
}
