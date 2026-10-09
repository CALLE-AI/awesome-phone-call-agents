import type { SurveyQuestion, SurveyQuestionType } from "./types";

const q = (
  id: string,
  prompt: string,
  type: SurveyQuestionType,
  extra: Partial<SurveyQuestion> = {},
): SurveyQuestion => ({ id, prompt, type, ...extra });

/** Reusable question bank for the fictional "Call Aunty" survey. */
export const CALL_AUNTY_SURVEY: SurveyQuestion[] = [
  q(
    "consent",
    "Is now a good time to answer a short survey, and may I record your answers for this survey?",
    "boolean",
    { required: true, sensitiveTags: ["consent"] },
  ),
  q("q01", "How would you describe your overall experience with the service?", "single_select", {
    options: ["Very positive", "Somewhat positive", "Neutral", "Somewhat negative", "Very negative"],
    skipWhen: { flag: "consentDenied" },
    sensitiveTags: ["experience"],
  }),
  q("q02", "How easy was it to get the help or information you needed?", "scale", {
    min: 1,
    max: 5,
    skipWhen: { flag: "consentDenied" },
  }),
  q("q03", "How clear were the instructions you received?", "scale", {
    min: 1,
    max: 5,
    skipWhen: { flag: "consentDenied" },
  }),
  q("q04", "How satisfied were you with the amount of time it took?", "scale", {
    min: 1,
    max: 5,
    skipWhen: { flag: "consentDenied" },
  }),
  q("q05", "Which parts of the experience worked best for you?", "multi_select", {
    options: ["Ease of use", "Staff helpfulness", "Speed", "Clarity", "Convenience", "Follow-up"],
    skipWhen: { any: [{ flag: "veryNegativeExperience" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["experience", "optional"],
  }),
  q("q06", "Was there anything confusing or frustrating?", "free_text", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["open_ended", "optional"],
    privacyNote: "If the answer names a safety concern, persist a code instead of a quotable narrative.",
  }),
  q("q07", "Were you able to complete what you originally wanted to do?", "boolean", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
  }),
  q("q08", "If you could change one thing, what would it be?", "free_text", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["open_ended", "optional"],
  }),
  q("q09", "How likely would you be to use the service again?", "scale", {
    min: 0,
    max: 10,
    skipWhen: {
      any: [
        { flag: "negativeExperience" },
        { flag: "distress" },
        { flag: "skipRemainingOptional" },
      ],
    },
    sensitiveTags: ["nps", "optional"],
  }),
  q("q10", "How likely would you be to recommend the service to someone you know?", "scale", {
    min: 0,
    max: 10,
    skipWhen: {
      any: [
        { flag: "negativeExperience" },
        { flag: "distress" },
        { flag: "skipRemainingOptional" },
      ],
    },
    sensitiveTags: ["nps", "optional"],
  }),
  q("q11", "Did you feel you had enough opportunity to ask questions?", "boolean", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
  }),
  q("q12", "Did the person helping you listen to your concerns?", "scale", {
    min: 1,
    max: 5,
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
  }),
  q("q13", "Did you receive the follow-up you expected?", "single_select", {
    options: ["Yes", "Partly", "No", "Not applicable"],
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
  }),
  q("q14", "How convenient was the timing or availability?", "scale", {
    min: 1,
    max: 5,
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
  }),
  q("q15", "What is the biggest benefit you received?", "free_text", {
    skipWhen: {
      any: [
        { flag: "veryNegativeExperience" },
        { flag: "distress" },
        { flag: "skipRemainingOptional" },
      ],
    },
    sensitiveTags: ["benefit", "open_ended", "optional"],
  }),
  q("q16", "What is the biggest improvement you would suggest?", "free_text", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["open_ended", "optional"],
  }),
  q("q17", "Is there anything important we did not ask about?", "free_text", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["open_ended", "optional"],
  }),
  q("q18", "Would you like someone to contact you about your feedback?", "boolean", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["contact", "optional"],
  }),
  q("q19", "What is your preferred way to be contacted?", "single_select", {
    options: ["Phone", "Email", "Text", "No follow-up"],
    skipRule: "q18 != true",
    skipWhen: {
      any: [
        { questionId: "q18", notEquals: true },
        { flag: "contactOptOut" },
        { flag: "distress" },
        { flag: "skipRemainingOptional" },
      ],
    },
    sensitiveTags: ["contact", "pii"],
    privacyNote: "Do not collect a contact address in this mock. Use synthetic IDs.",
  }),
  q("q20", "May your comments be quoted anonymously in an internal summary?", "boolean", {
    skipWhen: { any: [{ flag: "consentDenied" }, { flag: "distress" }, { flag: "skipRemainingOptional" }] },
    sensitiveTags: ["privacy", "optional"],
  }),
];

export const CALL_AUNTY_QUESTION_IDS = CALL_AUNTY_SURVEY.map((question) => question.id);

export function getCallAuntyQuestion(id: string): SurveyQuestion {
  const question = CALL_AUNTY_SURVEY.find((item) => item.id === id);
  if (!question) throw new Error(`Unknown Call Aunty question: ${id}`);
  return question;
}
