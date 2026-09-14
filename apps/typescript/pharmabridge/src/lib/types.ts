// Shared domain types. Kept free of server-only imports so the browser can use them too.

export type YesNoUnknown = "yes" | "no" | "unknown";

export type StockStatus =
  | "in_stock"
  | "partial"
  | "out_of_stock"
  | "refused_to_disclose"
  | "unknown";

export type ReachedParty =
  | "pharmacy_staff"
  | "facility_staff"
  | "automated_system_only"
  | "voicemail"
  | "no_answer"
  | "wrong_number"
  | "unknown";

export type AlternativeKind =
  | "generic"
  | "different_strength"
  | "different_form"
  | "none"
  | "not_discussed";

/** What the caller is trying to find: a medication on a pharmacy shelf, or blood units at a blood bank. */
export type NeedKind = "pharmacy" | "blood_bank";

export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
export const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export type BloodComponent = "whole_blood" | "packed_red_cells" | "platelets" | "fresh_frozen_plasma" | "cryoprecipitate";
export const BLOOD_COMPONENTS: Record<BloodComponent, string> = {
  packed_red_cells: "packed red blood cells",
  whole_blood: "whole blood",
  platelets: "platelets",
  fresh_frozen_plasma: "fresh frozen plasma",
  cryoprecipitate: "cryoprecipitate",
};

/** Structured result CALL-E extracts from each pharmacy stock inquiry. */
export interface InquiryResult {
  reached: ReachedParty;
  stock_status: StockStatus;
  can_fill_today: YesNoUnknown;
  quantity_on_hand: string;
  alternative_available: AlternativeKind;
  alternative_details: string;
  hold_offered: YesNoUnknown;
  hold_duration_hours: number;
  ready_time: string;
  cash_price: string;
  restock_eta: string;
  transfer_accepted: YesNoUnknown;
  staff_name: string;
  evidence_quote: string;
  notes: string;
}

/** Structured result CALL-E extracts from each blood bank availability inquiry. */
export interface BloodInquiryResult {
  reached: ReachedParty;
  stock_status: StockStatus;
  units_available: string;
  can_issue_today: YesNoUnknown;
  reserve_offered: YesNoUnknown;
  reserve_duration_hours: number;
  requisition_required: YesNoUnknown;
  crossmatch_sample_required: YesNoUnknown;
  replacement_donor_required: YesNoUnknown;
  processing_charge: string;
  open_24x7: YesNoUnknown;
  referral_or_restock: string;
  staff_name: string;
  evidence_quote: string;
  notes: string;
}

export type HoldNextStep =
  | "e_prescription_to_this_pharmacy"
  | "transfer_existing_prescription"
  | "bring_paper_prescription"
  | "none"
  | "unknown";

/** Structured result for the follow-up call that asks the pharmacy to set stock aside. */
export interface HoldResult {
  hold_confirmed: YesNoUnknown;
  hold_name: string;
  hold_until: string;
  reference: string;
  next_step_required: HoldNextStep;
  pickup_requirements: string;
  store_identifier: string;
  staff_name: string;
  evidence_quote: string;
}

/** Structured result for the follow-up call that asks the blood bank to reserve units. */
export interface BloodReserveResult {
  reserve_confirmed: YesNoUnknown;
  reserve_name: string;
  reserve_until: string;
  reference: string;
  documents_required: string;
  sample_required: YesNoUnknown;
  replacement_donors_required: string;
  charge_per_unit: string;
  staff_name: string;
  evidence_quote: string;
}

export type PrescriberRequestStatus =
  | "accepted"
  | "needs_prescriber_approval"
  | "patient_must_call"
  | "declined"
  | "unknown";

/** Structured result for the call that asks the prescriber's office to redirect the e-prescription. */
export interface PrescriberResult {
  request_status: PrescriberRequestStatus;
  expected_send_time: string;
  staff_name: string;
  follow_up_needed: string;
  evidence_quote: string;
}

export type TransferStatus =
  | "will_transfer"
  | "transferred"
  | "receiving_pharmacy_must_request"
  | "needs_prescriber"
  | "declined"
  | "unknown";

/** Structured result for the call that asks the patient's current pharmacy to transfer the prescription. */
export interface TransferResult {
  reached: ReachedParty;
  prescription_found: YesNoUnknown;
  transfer_status: TransferStatus;
  expected_time: string;
  reference: string;
  controlled_rule: string;
  follow_up_needed: string;
  staff_name: string;
  evidence_quote: string;
}

export type CallKind = "inquiry" | "hold" | "prescriber" | "transfer" | "blood_inquiry" | "blood_reserve";

/** simulation: no call leaves the server. test_line: dial an allowlisted stand-in. direct: dial the facility's verified listed number. */
export type Routing = "simulation" | "test_line" | "direct";

export type Urgency = "today" | "48h" | "week";

export interface Medication {
  rxcui: string | null;
  name: string;
  ingredient: string | null;
  brandNames: string[];
  quantity: string;
  alternatives: string[];
  controlled: boolean;
  deaSchedule: string | null;
  urgency: Urgency;
}

export interface BloodRequest {
  group: BloodGroup;
  component: BloodComponent;
  units: number;
  hospital: string;
  urgency: Urgency;
}

/** A pharmacy or blood bank found by discovery. */
export interface Facility {
  id: string;
  kind: NeedKind;
  name: string;
  brand: string | null;
  address: string;
  lat: number;
  lon: number;
  distanceKm: number;
  bearingDeg: number;
  phone: string | null;
  phoneMasked: string | null;
  openingHours: string | null;
  source: "openstreetmap" | "google" | "synthetic";
  mapsUrl: string | null;
  rating: number | null;
  openNow: boolean | null;
  /** Server-issued proof that `phone` came from PharmaBridge discovery; required for direct routing. */
  signature: string | null;
}

/** Older name kept for call sites that only deal with pharmacies. */
export type Pharmacy = Facility;

/** Minimum-necessary identity for a hold. Nothing else about the patient is ever sent to a pharmacy. */
export interface HoldContact {
  firstName: string;
  lastInitial: string;
  holdUntil: string;
}

export interface PrescriberContact {
  practice: string;
  prescriberName: string;
  phone: string;
  patientFullName: string;
  patientDob: string;
  consent: boolean;
}

/** The patient's current pharmacy, asked to transfer an unfilled prescription to one that has stock. */
export interface TransferContact {
  fromPharmacy: string;
  phone: string;
  patientFullName: string;
  patientDob: string;
  consent: boolean;
}

export interface TranscriptTurn {
  offsetSeconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export interface CallAttemptView {
  id: string;
  status: "queued" | "dialing" | "in_progress" | "completed" | "failed" | "canceled";
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  transcriptTurns: TranscriptTurn[];
  /** Matches the call record (and its audio) in the CALL-E dashboard. */
  providerCallId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

/** Mirrors the @call-e/calle `Call` shape so simulated and live calls share one UI path. */
export interface CallView {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  attempts: CallAttemptView[];
  simulated: boolean;
}

export interface CallEventView {
  id: string;
  type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  createdAt: string;
}

export type GuardrailId = "ai" | "privacy" | "medical" | "payment" | "voicemail" | "time" | "accept";

/** A call brief as structured data. The exact task text sent to CALL-E is rendered from it. */
export interface BriefSpec {
  kind: CallKind;
  title: string;
  goal: string;
  target: { label: string; value: string }[];
  notes: string[];
  opening: string;
  steps: { title: string; detail: string }[];
  ifYes: string[];
  ifNo: string[];
  guardrails: { id: GuardrailId; text: string }[];
}

export interface AppConfig {
  liveEnabled: boolean;
  directEnabled: boolean;
  keyConfigured: boolean;
  operatorCodeRequired: boolean;
  testLines: { index: number; masked: string; region: string | null }[];
  webhookConfigured: boolean;
  googlePlaces: boolean;
  dailyCap: number;
  liveCallsToday: number;
  recordsEnabled: boolean;
  /** Label of the optional AI provider (e.g. "Groq · llama-3.3-70b-versatile"), or null when none is configured. */
  ai: string | null;
}

export const TERMINAL_STATUSES: ReadonlyArray<CallView["status"]> = ["completed", "failed", "canceled"];
