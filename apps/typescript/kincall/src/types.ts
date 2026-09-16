// The structured vocabulary a CALL-E conversation is reduced to before any
// decision is taken.
//
// Every field a voice agent may fill is a closed enum or a plain sentence.
// Nothing here is free-form enough for an interpretation to reach the decision
// layer: the agent reports what was said, and the pure functions in this app
// decide what happens next.

export type YesNoUnknown = "yes" | "no" | "unknown";

export type Confidence = "low" | "medium" | "high";

// A closed list, so a free-text reason can never smuggle a medical
// interpretation into the record, and so an interface can label each one in
// plain language without parsing prose.
export const ATTENTION_REASONS = [
  "explicit_help_request",
  "fall",
  "mobility_difficulty",
  "pain_or_injury",
  "unusual_confusion",
  "distress",
  "abnormal_conversation_end",
  "person_not_reached",
  "other_attention_signal",
] as const;

export type AttentionReason = (typeof ATTENTION_REASONS)[number];

// The check-in call's result, normalised to camelCase.
export interface NormalizedCompanionResult {
  // One or two neutral sentences describing what the person actually said,
  // reported as something they said rather than as a diagnosis.
  neutralSummary: string;
  // Whether a two-way conversation actually happened. A voicemail is a
  // completed call with no concerning signals, which without this field reads
  // identically to "the person is fine".
  personReached: YesNoUnknown;
  // "yes" only when the person explicitly asked — never inferred from silence.
  explicitHelpRequested: YesNoUnknown;
  fallMentioned: YesNoUnknown;
  mobilityDifficulty: YesNoUnknown;
  painOrInjuryMentioned: YesNoUnknown;
  unusualConfusion: YesNoUnknown;
  distressExpressed: YesNoUnknown;
  conversationEndedNormally: YesNoUnknown;
  doesNotWantToDisturbFamily: YesNoUnknown;
  otherAttentionSignal: YesNoUnknown;
  // The agent's own judgement. Deliberately only ONE input among several — see
  // decision-tree.ts for the two rules that override it.
  attentionRequired: YesNoUnknown;
  attentionReasons: AttentionReason[];
  confidence: Confidence;
}

// One trusted-contact call's result.
export interface FamilyStructuredResult {
  contact_id: string;
  answered: YesNoUnknown;
  situation_understood: YesNoUnknown;
  // Only an explicit "yes" stops the cascade. "unknown" means the contact was
  // vague or non-committal, which must never be recorded as a commitment.
  can_intervene: YesNoUnknown;
  intervention_type: "visit" | "call" | "other";
  // Free text as the contact said it ("this afternoon", "17:30"). Never parsed
  // into a time and never compared against a clock.
  estimated_time: string;
  contact_next_person: YesNoUnknown;
  summary: string;
  // Optional and only ever a model self-report: a provider that cannot confirm
  // a voicemail must not have one inferred on its behalf.
  voicemail_left?: YesNoUnknown;
}

// The minimum a trusted contact needs for ordering and eligibility. A real
// deployment carries more; nothing else is needed to decide who is called next.
export interface TrustedContact {
  id: string;
  firstName: string;
  // 1-based cascade order. Contacts are called one at a time, lowest first.
  priority: number;
  // No call is placed to anyone whose consent is not confirmed, in any mode.
  consentStatus: "pending" | "confirmed" | "declined";
  // A contact temporarily switched off by the family.
  enabled: boolean;
}

// The two decisions this app produces from a check-in.
export type OrchestrationDecision =
  | "LOG_AND_CLOSE"
  | "RETRY_CHECK_IN"
  | "CONTACT_TRUSTED_PERSON";
