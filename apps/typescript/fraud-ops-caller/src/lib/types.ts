export const INTENTS = [
  "kyc_chase",
  "evidence_collection",
  "collections",
  "merchant_outreach",
] as const;

export type Intent = (typeof INTENTS)[number];

export const PACKS = [
  "needs_kyc",
  "needs_evidence",
  "past_due",
  "merchant_review",
] as const;
export type PackFired = (typeof PACKS)[number];

export const DISPOSITIONS = {
  collections: [
    "paid",
    "ptp",
    "refuse",
    "wrong_party",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  kyc_chase: [
    "uploading_now",
    "callback",
    "confused",
    "refuse",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  merchant_outreach: [
    "reached",
    "docs_promised",
    "wrong_contact",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  evidence_collection: [
    "statement_taken",
    "will_upload",
    "refused",
    "unsafe_escalate",
    "wrong_party",
    "voicemail",
    "no_answer",
    "handoff",
  ],
} as const;

export type Disposition<I extends Intent = Intent> =
  (typeof DISPOSITIONS)[I][number];

export type CaseContact = {
  name: string;
  phone_e164: string;
  role: string;
  locale: string;
};

export type CaseContext = {
  missing_docs?: string[];
  amount_due?: number;
  currency?: string;
  days_late?: number;
  merchant_name?: string;
  risk_flags?: string[];
};

export type DeepLinks = {
  upload?: string;
  pay?: string;
  portal?: string;
  evidence_share?: string;
};

export type CasePolicy = {
  attempt_n: number;
  max_attempts: number;
  quiet_hours_local: string;
  allow_ptp: boolean;
  allow_pay_link_sms: boolean;
};

export type FraudOpsCase = {
  case_id: string;
  intent: Intent;
  pack_fired: PackFired;
  reason_plain: string;
  contact: CaseContact;
  context: CaseContext;
  deep_links: DeepLinks;
  policy: CasePolicy;
  callback_url: string;
  counterpart_case_id?: string;
  safety_sensitive?: boolean;
  incident_summary_plain?: string;
  tarka?: Record<string, unknown>;
};

export const TOOL_IDS = [
  "none",
  "check_payment_eligibility",
  "generate_hardship_plan",
  "execute_emergency_containment",
  "fetch_previous_context",
  "assign_human_spoc",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export type OutcomeFields = {
  ptp_date?: string;
  missing_docs?: string[];
  callback_at?: string;
  contact_role?: string;
  handoff_reason?: string;
  /** ISO datetime — proactive follow-up before SLA slip */
  follow_up_at?: string;
  sentiment_check_sent?: boolean;
  advocate_assigned?: boolean;
  root_cause_note?: string;
  nvc_state?: string;
  tool_invoked?: ToolId;
  hostility_strikes?: 0 | 1 | 2;
  deescalation_override?: boolean;
  unsafe_flag?: boolean;
};

export type FraudOpsOutcome = {
  case_id: string;
  intent: Intent;
  call_id: string;
  recording_id: string;
  disposition: Disposition;
  quotes: string[];
  next_action: string;
  fields: OutcomeFields;
  transcript_snippet: string;
  ended_at: string;
};
