import { applySurveyAnswer, SAFETY_CONCERN_CODE } from "./branching";
import type { BranchDecision, CallScriptKey, SensitiveCategory, SensitiveEscalation, SurveyAnswer, SurveyFlags } from "./types";

export interface SensitiveAnswerBranchFixture {
  id: string;
  title: string;
  purpose: string;
  synthetic: true;
  respondent: string;
  priorAnswers: Record<string, SurveyAnswer>;
  questionId: string;
  answer: SurveyAnswer;
  spoken: string;
  expected: {
    category: SensitiveCategory | null;
    escalation: SensitiveEscalation;
    persistAnswer: SurveyAnswer;
    nextQuestionId: string | null;
    flags: Partial<SurveyFlags>;
    skippedContains: string[];
    skippedExcludes?: string[];
    agentScriptKeys: CallScriptKey[];
    persistMustNotContain?: string[];
  };
}

const GRANTED = { consent: true as const };

export const SENSITIVE_ANSWER_BRANCHES: readonly SensitiveAnswerBranchFixture[] = [
  {
    id: "branch-consent-refused",
    title: "Consent refused — no later questions",
    purpose: "A clear no must end the survey without collecting ratings.",
    synthetic: true,
    respondent: "Aunty May",
    priorAnswers: {},
    questionId: "consent",
    answer: false,
    spoken: "No, thanks. I do not want to do a survey.",
    expected: {
      category: "consent_refused",
      escalation: "none",
      persistAnswer: false,
      nextQuestionId: null,
      flags: { consentDenied: true, consentPending: false },
      skippedContains: ["q01", "q06", "q18"],
      agentScriptKeys: [],
    },
  },
  {
    id: "branch-negative-experience",
    title: "Somewhat negative — skip recommend/return scales",
    purpose: "Negative experience must not be followed by NPS-style prompts.",
    synthetic: true,
    respondent: "Aunty Noor",
    priorAnswers: GRANTED,
    questionId: "q01",
    answer: "Somewhat negative",
    spoken: "Somewhat negative. The wait was long.",
    expected: {
      category: "negative_experience",
      escalation: "none",
      persistAnswer: "Somewhat negative",
      nextQuestionId: "q02",
      flags: { negativeExperience: true, veryNegativeExperience: false, consentPending: false },
      skippedContains: ["q09", "q10"],
      skippedExcludes: ["q02", "q06"],
      agentScriptKeys: ["acknowledge_negative"],
    },
  },
  {
    id: "branch-very-negative-experience",
    title: "Very negative — skip benefit and recommend questions",
    purpose: "Do not ask what worked best after a very negative rating.",
    synthetic: true,
    respondent: "Aunty Ruth",
    priorAnswers: GRANTED,
    questionId: "q01",
    answer: "Very negative",
    spoken: "Very negative. I felt rushed the whole time.",
    expected: {
      category: "negative_experience",
      escalation: "none",
      persistAnswer: "Very negative",
      nextQuestionId: "q02",
      flags: { negativeExperience: true, veryNegativeExperience: true, consentPending: false },
      skippedContains: ["q05", "q09", "q10", "q15"],
      skippedExcludes: ["q06"],
      agentScriptKeys: ["acknowledge_negative", "q06_careful"],
    },
  },
  {
    id: "branch-distress-en",
    title: "English distress phrase — stop probing",
    purpose: "Safety-sensitive language persists a code, not a quotable narrative.",
    synthetic: true,
    respondent: "Aunty Cora",
    priorAnswers: { ...GRANTED, q01: "Neutral" },
    questionId: "q06",
    answer: "I have chest pain and trouble breathing.",
    spoken: "I have chest pain and trouble breathing.",
    expected: {
      category: "distress",
      escalation: "safety_script",
      persistAnswer: SAFETY_CONCERN_CODE,
      nextQuestionId: null,
      flags: { distress: true, skipRemainingOptional: true },
      skippedContains: ["q07", "q18", "q20"],
      agentScriptKeys: ["safety_stop_probing"],
      persistMustNotContain: ["chest pain", "breathing"],
    },
  },
  {
    id: "branch-distress-bn",
    title: "Bangla distress phrase — stop probing",
    purpose: "Multilingual safety patterns must take the same stop-probing branch.",
    synthetic: true,
    respondent: "Aunty Lila",
    priorAnswers: { ...GRANTED, q01: "Neutral" },
    questionId: "q06",
    answer: "তীব্র ব্যথা হচ্ছে",
    spoken: "তীব্র ব্যথা হচ্ছে",
    expected: {
      category: "distress",
      escalation: "safety_script",
      persistAnswer: SAFETY_CONCERN_CODE,
      nextQuestionId: null,
      flags: { distress: true, skipRemainingOptional: true },
      skippedContains: ["q07", "q08"],
      agentScriptKeys: ["safety_stop_probing"],
    },
  },
  {
    id: "branch-skip-remaining",
    title: "Skip the rest — stop optional questions",
    purpose: "An explicit skip must not be treated as missing data to chase.",
    synthetic: true,
    respondent: "Aunty Rose",
    priorAnswers: { ...GRANTED, q01: "Somewhat positive" },
    questionId: "q06",
    answer: "Please skip the rest.",
    spoken: "Please skip the rest.",
    expected: {
      category: "skip_requested",
      escalation: "stop_probing",
      persistAnswer: "Please skip the rest.",
      nextQuestionId: null,
      flags: { skipRemainingOptional: true },
      skippedContains: ["q07", "q18"],
      agentScriptKeys: ["offer_skip"],
    },
  },
  {
    id: "branch-skip-null",
    title: "Null answer — treated as skip requested",
    purpose: "A structured skip (null) must not coerce a value.",
    synthetic: true,
    respondent: "Aunty Jo",
    priorAnswers: { ...GRANTED, q01: "Somewhat positive" },
    questionId: "q08",
    answer: null,
    spoken: "I would rather not answer that.",
    expected: {
      category: "skip_requested",
      escalation: "stop_probing",
      persistAnswer: null,
      nextQuestionId: null,
      flags: { skipRemainingOptional: true },
      skippedContains: ["q09", "q10"],
      agentScriptKeys: ["offer_skip"],
    },
  },
  {
    id: "branch-contact-opt-out",
    title: "No follow-up contact — skip preferred channel",
    purpose: "Do not collect a contact channel after an opt-out.",
    synthetic: true,
    respondent: "Aunty Rose",
    priorAnswers: { ...GRANTED, q01: "Very positive" },
    questionId: "q18",
    answer: false,
    spoken: "No, I would rather not be contacted.",
    expected: {
      category: "contact_opt_out",
      escalation: "none",
      persistAnswer: false,
      nextQuestionId: "q20",
      flags: { contactOptOut: true },
      skippedContains: ["q19"],
      skippedExcludes: ["q20"],
      agentScriptKeys: ["skip_no_followup"],
    },
  },
  {
    id: "branch-pii-email",
    title: "Free-text email — redact before persist",
    purpose: "Optional comments must not store a raw inbox address.",
    synthetic: true,
    respondent: "Aunty Pat",
    priorAnswers: { ...GRANTED, q01: "Very positive" },
    questionId: "q08",
    answer: "Email me at aunty.pat@example.test if you need more detail.",
    spoken: "Email me at aunty.pat@example.test if you need more detail.",
    expected: {
      category: "pii_risk",
      escalation: "none",
      persistAnswer: "Email me at [redacted-email] if you need more detail.",
      nextQuestionId: "q09",
      flags: { consentPending: false },
      skippedContains: [],
      agentScriptKeys: [],
      persistMustNotContain: ["aunty.pat@example.test"],
    },
  },
  {
    id: "branch-pii-phone",
    title: "Free-text number — redact before persist",
    purpose: "A spoken callback number is replaced with a redaction token.",
    synthetic: true,
    respondent: "Aunty Sal",
    priorAnswers: { ...GRANTED, q01: "Somewhat positive" },
    questionId: "q17",
    answer: "Please use +1 555 555 0199 if someone needs to follow up.",
    spoken: "Please use +1 555 555 0199 if someone needs to follow up.",
    expected: {
      category: "pii_risk",
      escalation: "none",
      persistAnswer: "Please use [redacted-number] if someone needs to follow up.",
      nextQuestionId: "q18",
      flags: { consentPending: false },
      skippedContains: [],
      agentScriptKeys: [],
      persistMustNotContain: ["555 555 0199"],
    },
  },
  {
    id: "branch-human-followup",
    title: "Very negative + wants contact — human callback",
    purpose: "Do not auto-continue; route a human follow-up instead.",
    synthetic: true,
    respondent: "Aunty Ruth",
    priorAnswers: { ...GRANTED, q01: "Very negative" },
    questionId: "q18",
    answer: true,
    spoken: "Yes. Please have a person call me.",
    expected: {
      category: "human_followup",
      escalation: "human_callback",
      persistAnswer: true,
      nextQuestionId: "q19",
      flags: { veryNegativeExperience: true, contactOptOut: false },
      skippedContains: ["q09", "q10"],
      agentScriptKeys: [],
    },
  },
  {
    id: "branch-happy-path",
    title: "Non-sensitive completed answer",
    purpose: "Ordinary answers must not trigger safety or redaction branches.",
    synthetic: true,
    respondent: "Aunty Pat",
    priorAnswers: GRANTED,
    questionId: "q01",
    answer: "Very positive",
    spoken: "Very positive.",
    expected: {
      category: null,
      escalation: "none",
      persistAnswer: "Very positive",
      nextQuestionId: "q02",
      flags: { negativeExperience: false, distress: false, consentPending: false },
      skippedContains: [],
      skippedExcludes: ["q09", "q10"],
      agentScriptKeys: [],
    },
  },
];

export function getSensitiveAnswerBranch(id: string): SensitiveAnswerBranchFixture {
  const fixture = SENSITIVE_ANSWER_BRANCHES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown sensitive-answer branch: ${id}`);
  return fixture;
}

export function applySensitiveAnswerBranch(fixture: SensitiveAnswerBranchFixture): BranchDecision {
  return applySurveyAnswer({
    answers: fixture.priorAnswers,
    questionId: fixture.questionId,
    answer: fixture.answer,
    spoken: fixture.spoken,
  });
}
