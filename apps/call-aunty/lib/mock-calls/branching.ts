import type { BranchAction, BranchDecision, CallScriptKey, MockTurn, SensitiveCategory, SensitiveEscalation, SkipWhen, SurveyAnswer, SurveyFlags, SurveyQuestion } from "./types";
import { CALL_AUNTY_SURVEY } from "./survey";

const EMPTY_FLAGS: SurveyFlags = {
  consentDenied: false,
  consentPending: true,
  distress: false,
  skipRemainingOptional: false,
  contactOptOut: false,
  negativeExperience: false,
  veryNegativeExperience: false,
};

const DISTRESS_PATTERNS: readonly RegExp[] = [
  /\b(severe|heavy)\s+(pain|bleeding|bleed)\b/i,
  /\b(can't|cannot|hard to|trouble|difficulty)\s+breath/i,
  /\bbaby\s+(not|isn't|is not)\s+mov/i,
  /\b(emergency|urgent\s+care|faint(?:ing)?|chest pain)\b/i,
  /রক্তপাত|তীব্র ব্যথা|শ্বাস(?:কষ্ট)?|জরুরি/,
  /रक्तस्राव|तेज़ दर्द|सांस|आपातकाल/,
  /خون بہنا|شدید درد|سانس|ہنگامی/,
  /கடுமையான வலி|மூச்சு|அவசரம்|இரத்தப் போக்கு/,
  /తీవ్రమైన నొప్పి|శ్వాస|అత్యవసర|రక్తస్రావం/,
];

const SKIP_REMAINING_PATTERNS: readonly RegExp[] = [
  /\b(don't|do not|please don't)\s+(ask|talk).*(more|further|about that)\b/i,
  /\bskip\s+(the\s+)?(rest|remaining|optional)?\b/i,
  /আর(?:ও)?\s+জিজ্ঞাসা\s+করবেন\s+না|আর কথা বলতে চাই না/,
  /और\s+मत\s+पूछिए|और बात नहीं करनी/,
];

const PII_PATTERNS: readonly RegExp[] = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /\+?\d[\d\s().-]{7,}\d/,
];

export const SAFETY_CONCERN_CODE = "safety_concern_reported";

export function emptySurveyFlags(): SurveyFlags {
  return { ...EMPTY_FLAGS };
}

export function matchesSkipWhen(rule: SkipWhen | undefined, answers: Record<string, SurveyAnswer>, flags: SurveyFlags): boolean {
  if (!rule) return false;
  if ("questionId" in rule && "equals" in rule) return answers[rule.questionId] === rule.equals;
  if ("questionId" in rule && "notEquals" in rule) return answers[rule.questionId] !== rule.notEquals;
  if ("questionId" in rule && "oneOf" in rule) return rule.oneOf.some((value) => answers[rule.questionId] === value);
  if ("flag" in rule) return flags[rule.flag];
  if ("all" in rule) return rule.all.every((item) => matchesSkipWhen(item, answers, flags));
  if ("any" in rule) return rule.any.some((item) => matchesSkipWhen(item, answers, flags));
  return false;
}

/** Legacy skipRule strings from the original fixture, e.g. `q18 != true`. */
export function matchesSkipRule(rule: string | undefined, answers: Record<string, SurveyAnswer>): boolean {
  if (!rule) return false;
  const notEquals = rule.match(/^(\w+)\s*!=\s*(.+)$/);
  if (notEquals) {
    const expected = parseSkipLiteral(notEquals[2]);
    return answers[notEquals[1]] !== expected;
  }
  const equals = rule.match(/^(\w+)\s*==\s*(.+)$/);
  if (equals) {
    const expected = parseSkipLiteral(equals[2]);
    return answers[equals[1]] === expected;
  }
  return false;
}

function parseSkipLiteral(raw: string): SurveyAnswer {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const asNumber = Number(value);
  if (value !== "" && Number.isFinite(asNumber) && value === String(asNumber)) return asNumber;
  return value.replace(/^['"]|['"]$/g, "");
}

export function shouldAskQuestion(
  question: SurveyQuestion,
  answers: Record<string, SurveyAnswer>,
  flags: SurveyFlags,
): boolean {
  if (question.id !== "consent" && (flags.consentDenied || flags.consentPending)) return false;
  if (flags.distress && question.id !== "consent" && question.id !== "q01" && question.id !== "q06") return false;
  if (matchesSkipRule(question.skipRule, answers)) return false;
  if (matchesSkipWhen(question.skipWhen, answers, flags)) return false;
  return true;
}

export function nextAskableQuestion(
  survey: SurveyQuestion[] = CALL_AUNTY_SURVEY,
  answers: Record<string, SurveyAnswer> = {},
  flags: SurveyFlags = emptySurveyFlags(),
  afterId?: string,
): SurveyQuestion | null {
  const start = afterId ? survey.findIndex((question) => question.id === afterId) + 1 : 0;
  for (let index = Math.max(0, start); index < survey.length; index += 1) {
    const question = survey[index];
    if (answers[question.id] !== undefined) continue;
    if (shouldAskQuestion(question, answers, flags)) return question;
  }
  return null;
}

export function classifySensitiveText(text: string): SensitiveCategory | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (DISTRESS_PATTERNS.some((pattern) => pattern.test(trimmed))) return "distress";
  if (SKIP_REMAINING_PATTERNS.some((pattern) => pattern.test(trimmed))) return "skip_requested";
  if (PII_PATTERNS.some((pattern) => pattern.test(trimmed))) return "pii_risk";
  return null;
}

export function redactPii(text: string): string {
  return text.replace(PII_PATTERNS[0], "[redacted-email]").replace(PII_PATTERNS[1], "[redacted-number]");
}

export function flagsFromAnswers(answers: Record<string, SurveyAnswer>, spokenByQuestion: Record<string, string> = {}): SurveyFlags {
  const flags = emptySurveyFlags();
  if (answers.consent === true) {
    flags.consentPending = false;
    flags.consentDenied = false;
  } else if (answers.consent === false) {
    flags.consentPending = false;
    flags.consentDenied = true;
  }

  const experience = answers.q01;
  if (experience === "Somewhat negative" || experience === "Very negative") flags.negativeExperience = true;
  if (experience === "Very negative") flags.veryNegativeExperience = true;
  if (answers.q18 === false) flags.contactOptOut = true;
  if (answers.q06 === SAFETY_CONCERN_CODE) {
    flags.distress = true;
    flags.skipRemainingOptional = true;
  }

  const spoken = Object.values(spokenByQuestion).join("\n");
  const q06Text = typeof answers.q06 === "string" ? answers.q06 : "";
  const combined = [spoken, q06Text].filter(Boolean).join("\n");
  const sensitive = classifySensitiveText(combined);
  if (sensitive === "distress") {
    flags.distress = true;
    flags.skipRemainingOptional = true;
  } else if (sensitive === "skip_requested") {
    flags.skipRemainingOptional = true;
  }
  return flags;
}

function persistAnswer(questionId: string, answer: SurveyAnswer, spoken: string): SurveyAnswer {
  if (questionId === "q06" && classifySensitiveText(spoken) === "distress") return SAFETY_CONCERN_CODE;
  if (typeof answer === "string") return redactPii(answer);
  return answer;
}

export function applySurveyAnswer(input: {
  survey?: SurveyQuestion[];
  answers?: Record<string, SurveyAnswer>;
  flags?: SurveyFlags;
  questionId: string;
  answer: SurveyAnswer;
  spoken?: string;
}): BranchDecision {
  const survey = input.survey ?? CALL_AUNTY_SURVEY;
  const spoken = input.spoken ?? (typeof input.answer === "string" ? input.answer : "");
  const answers = { ...(input.answers ?? {}), [input.questionId]: input.answer };
  let category = classifySensitiveAnswer(input.questionId, input.answer, spoken);
  const flags = flagsFromAnswers(answers, spoken ? { [input.questionId]: spoken } : {});
  if (input.flags?.skipRemainingOptional) flags.skipRemainingOptional = true;
  if (input.flags?.distress) flags.distress = true;
  if (input.flags?.veryNegativeExperience) flags.veryNegativeExperience = true;
  if (input.flags?.negativeExperience) flags.negativeExperience = true;

  if (category === "distress") {
    flags.distress = true;
    flags.skipRemainingOptional = true;
  }
  if (category === "skip_requested") flags.skipRemainingOptional = true;
  if (category === "contact_opt_out") flags.contactOptOut = true;

  answers[input.questionId] = persistAnswer(input.questionId, input.answer, spoken);

  const actions: BranchAction[] = [];
  const agentScriptKeys: CallScriptKey[] = [];
  let escalation: SensitiveEscalation = "none";

  if (input.questionId === "consent" && input.answer !== true) {
    actions.push({ type: "end_survey", reason: "consent_not_granted" });
    flags.consentDenied = input.answer === false;
    flags.consentPending = input.answer == null;
  }

  if (flags.veryNegativeExperience && input.questionId === "q01") {
    actions.push({ type: "skip_questions", ids: ["q05", "q09", "q10", "q15"] });
    agentScriptKeys.push("acknowledge_negative", "q06_careful");
  } else if (flags.negativeExperience && input.questionId === "q01") {
    actions.push({ type: "skip_questions", ids: ["q09", "q10"] });
    agentScriptKeys.push("acknowledge_negative");
  }

  if (input.questionId === "q18" && input.answer === true && flags.veryNegativeExperience) {
    category = "human_followup";
    escalation = "human_callback";
    actions.push({ type: "escalate", route: "human_callback" });
  }

  if (category === "distress") {
    escalation = "safety_script";
    actions.push(
      { type: "persist_code", questionId: input.questionId, code: SAFETY_CONCERN_CODE },
      { type: "escalate", route: "safety_script" },
      { type: "end_survey", reason: "distress_stop_probing" },
    );
    agentScriptKeys.push("safety_stop_probing");
  } else if (category === "skip_requested") {
    escalation = "stop_probing";
    flags.skipRemainingOptional = true;
    actions.push({ type: "offer_skip" });
    agentScriptKeys.push("offer_skip");
  } else if (category === "contact_opt_out") {
    actions.push({ type: "skip_questions", ids: ["q19"] });
    agentScriptKeys.push("skip_no_followup");
  } else if (category === "pii_risk") {
    actions.push({ type: "persist_code", questionId: input.questionId, code: "[redacted]" });
  }

  const skippedQuestionIds = survey
    .filter((question) => question.id !== input.questionId && !shouldAskQuestion(question, answers, flags))
    .map((question) => question.id);

  const next = nextAskableQuestion(survey, answers, flags, input.questionId);

  return {
    flags,
    actions,
    skippedQuestionIds,
    nextQuestionId: next?.id ?? null,
    escalation,
    persistAnswer: answers[input.questionId],
    agentScriptKeys,
    category,
  };
}

function classifySensitiveAnswer(questionId: string, answer: SurveyAnswer, spoken: string): SensitiveCategory | null {
  if (questionId === "consent" && answer !== true) return "consent_refused";
  if (questionId === "q01" && (answer === "Somewhat negative" || answer === "Very negative")) return "negative_experience";
  if (questionId === "q18" && answer === false) return "contact_opt_out";
  const fromText = classifySensitiveText(spoken);
  if (fromText) return fromText;
  if (answer === null) return "skip_requested";
  return null;
}

export function replayTranscriptAnswers(
  transcript: MockTurn[],
  survey: SurveyQuestion[] = CALL_AUNTY_SURVEY,
): { answers: Record<string, SurveyAnswer>; flags: SurveyFlags; askedQuestionIds: string[]; escalation: SensitiveEscalation } {
  let answers: Record<string, SurveyAnswer> = {};
  let flags = emptySurveyFlags();
  let escalation: SensitiveEscalation = "none";
  const askedQuestionIds: string[] = [];

  for (const turn of transcript) {
    if (turn.questionId && turn.speaker === "agent") {
      askedQuestionIds.push(turn.questionId);
    }
    if (!turn.questionId || turn.answer === undefined || turn.speaker !== "aunty") continue;
    const spoken = turn.text;
    const decision = applySurveyAnswer({
      survey,
      answers,
      flags,
      questionId: turn.questionId,
      answer: turn.answer,
      spoken,
    });
    answers = { ...answers, [turn.questionId]: decision.persistAnswer };
    flags = decision.flags;
    if (decision.escalation !== "none") escalation = decision.escalation;
  }

  return { answers, flags, askedQuestionIds: unique(askedQuestionIds), escalation };
}

export function consentBlocksLaterQuestions(transcript: MockTurn[]): boolean {
  const consentTurn = transcript.find((turn) => turn.questionId === "consent" && turn.speaker === "aunty");
  const granted = consentTurn?.answer === true;
  if (granted) return false;
  return transcript.every((turn) => !turn.questionId || turn.questionId === "consent" || turn.speaker === "system");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
