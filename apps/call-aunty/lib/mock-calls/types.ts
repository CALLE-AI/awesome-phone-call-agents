import type { AppLanguage } from "@/lib/language";

export type SurveyAnswer = string | number | boolean | string[] | null;

export type SurveyQuestionType =
  | "single_select"
  | "multi_select"
  | "scale"
  | "number"
  | "boolean"
  | "free_text";

export type SensitiveTag =
  | "consent"
  | "experience"
  | "open_ended"
  | "nps"
  | "benefit"
  | "contact"
  | "pii"
  | "privacy"
  | "optional";

export type SkipWhen =
  | { questionId: string; equals: SurveyAnswer }
  | { questionId: string; notEquals: SurveyAnswer }
  | { questionId: string; oneOf: SurveyAnswer[] }
  | { flag: SurveyFlag }
  | { all: SkipWhen[] }
  | { any: SkipWhen[] };

export type SurveyFlag =
  | "consentDenied"
  | "consentPending"
  | "distress"
  | "skipRemainingOptional"
  | "contactOptOut"
  | "negativeExperience"
  | "veryNegativeExperience";

export type CallScriptKey =
  | "greeting_named"
  | "greeting_generic"
  | "consent_prompt"
  | "thanks_testing"
  | "decline_close"
  | "reschedule_offer"
  | "reschedule_ack"
  | "skip_no_followup"
  | "voicemail"
  | "complete"
  | "acknowledge_negative"
  | "offer_skip"
  | "safety_stop_probing"
  | "q06_careful"
  | "system_reschedule"
  | "system_voicemail"
  | "system_transport"
  | "system_safety";

export interface SurveyQuestion {
  id: string;
  prompt: string;
  type: SurveyQuestionType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  skipRule?: string;
  skipWhen?: SkipWhen;
  privacyNote?: string;
  sensitiveTags?: SensitiveTag[];
}

export interface MockTurn {
  speaker: "agent" | "aunty" | "system";
  text: string;
  questionId?: string;
  answer?: SurveyAnswer;
  scriptKey?: CallScriptKey;
  scriptParams?: Record<string, string>;
}

export type MockCallOutcome =
  | "completed"
  | "declined"
  | "voicemail"
  | "rescheduled"
  | "technical_failure";

export type SensitiveEscalation = "none" | "stop_probing" | "safety_script" | "human_callback";

export interface MockCallScenario {
  id: string;
  title: string;
  purpose: string;
  respondentProfile: string;
  outcome: MockCallOutcome;
  locale?: AppLanguage;
  survey: SurveyQuestion[];
  transcript: MockTurn[];
  extractedAnswers: Record<string, SurveyAnswer>;
  assertions: string[];
  escalation?: SensitiveEscalation;
}

export type SurveyFlags = Record<SurveyFlag, boolean>;

export type BranchAction =
  | { type: "end_survey"; reason: string }
  | { type: "skip_questions"; ids: string[] }
  | { type: "escalate"; route: SensitiveEscalation }
  | { type: "persist_code"; questionId: string; code: string }
  | { type: "offer_skip" };

export type SensitiveCategory =
  | "consent_refused"
  | "distress"
  | "negative_experience"
  | "contact_opt_out"
  | "skip_requested"
  | "pii_risk"
  | "human_followup";

export type BranchDecision = {
  flags: SurveyFlags;
  actions: BranchAction[];
  skippedQuestionIds: string[];
  nextQuestionId: string | null;
  escalation: SensitiveEscalation;
  persistAnswer: SurveyAnswer;
  agentScriptKeys: CallScriptKey[];
  category: SensitiveCategory | null;
};
