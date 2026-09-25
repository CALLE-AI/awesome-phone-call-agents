import type { CallPurpose } from "../../calle/types";

export type PromptTemplate = {
  id: string;
  version: string;
  purpose: CallPurpose;
  title: string;
  allowedTopics: string[];
  forbiddenTopics: string[];
  goals: string[];
  questions: string[];
  successCriteria: string[];
  escalationCriteria: string[];
  dataToCapture: string[];
  stopAndHandoffWhen: string[];
};

const SHARED_FORBIDDEN = [
  "diagnosis",
  "prescriptions",
  "dosage advice",
  "claiming to be a clinician",
  "collecting unnecessary PII",
];

const SHARED_ESCALATION = [
  "Reports emergency symptoms",
  "Requests clinical diagnosis or medication advice",
  "Expresses immediate safety concern",
];

export const PROMPT_REGISTRY: Record<CallPurpose, PromptTemplate> = {
  follow_up_after_check_in: {
    id: "follow_up_after_check_in",
    version: "v3.1.0",
    purpose: "follow_up_after_check_in",
    title: "Post check-in logistics follow-up",
    allowedTopics: ["reachability", "callback timing", "need for human CHW"],
    forbiddenTopics: SHARED_FORBIDDEN,
    goals: ["Confirm reachability", "Detect need for human callback"],
    questions: [
      "Are you available for a short care-coordination call?",
      "Do you need a community health worker to call you back today?",
      "What callback window works best?",
    ],
    successCriteria: ["Reached or clear no-answer", "Next action captured"],
    escalationCriteria: SHARED_ESCALATION,
    dataToCapture: ["reached", "preferredCallbackWindow", "needsHumanFollowUp", "safetyEscalation"],
    stopAndHandoffWhen: ["Urgent symptoms", "Consent withdrawn mid-call"],
  },
  appointment_coordination: {
    id: "appointment_coordination",
    version: "v3.1.0",
    purpose: "appointment_coordination",
    title: "Appointment coordination",
    allowedTopics: ["visit scheduling", "reschedule window", "callback preference"],
    forbiddenTopics: SHARED_FORBIDDEN,
    goals: ["Confirm appointment status", "Capture preferred window if reschedule needed"],
    questions: [
      "Is your care visit still scheduled?",
      "Do you need to reschedule?",
      "What daypart works for a callback?",
    ],
    successCriteria: ["Appointment confirmed or reschedule requested"],
    escalationCriteria: SHARED_ESCALATION,
    dataToCapture: ["appointmentConfirmed", "preferredCallbackWindow", "nextAction"],
    stopAndHandoffWhen: ["Urgent symptoms", "Confusion about clinical advice"],
  },
  callback_confirmation: {
    id: "callback_confirmation",
    version: "v3.1.0",
    purpose: "callback_confirmation",
    title: "Callback confirmation",
    allowedTopics: ["prior callback arrangement", "new preferred window"],
    forbiddenTopics: SHARED_FORBIDDEN,
    goals: ["Confirm prior callback still works"],
    questions: [
      "Does the previously arranged callback still work?",
      "If not, what window is better?",
    ],
    successCriteria: ["Callback confirmed or new window captured"],
    escalationCriteria: SHARED_ESCALATION,
    dataToCapture: ["preferredCallbackWindow", "needsHumanFollowUp"],
    stopAndHandoffWhen: ["Urgent symptoms"],
  },
};

export function getPromptTemplate(purpose: CallPurpose): PromptTemplate {
  return PROMPT_REGISTRY[purpose];
}

/** Snapshot assembly for tests — redacted demo context only. */
export function assemblePromptPreview(purpose: CallPurpose, locale: string) {
  const t = getPromptTemplate(purpose);
  return {
    id: t.id,
    version: t.version,
    locale,
    title: t.title,
    goals: t.goals,
    questions: t.questions,
    forbiddenTopics: t.forbiddenTopics,
    stopAndHandoffWhen: t.stopAndHandoffWhen,
    note: "DEMO — no beneficiary PII included",
  };
}
