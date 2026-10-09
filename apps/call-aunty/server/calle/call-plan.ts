import type { CallPurpose } from "./types";
import { assertSafeCallContent } from "./content-guard";

export type CallPlan = {
  opening: string;
  objective: string;
  boundedQuestions: string[];
  prohibitedTopics: string[];
  escalationLanguage: string;
  desiredOutputs: string[];
  taskText: string;
};

const PROHIBITED = [
  "diagnosis",
  "prescription",
  "medication dosage",
  "clinical certainty beyond logistics",
];

const ESCALATION =
  "If the person reports emergency symptoms, tell them to seek urgent in-person care immediately and end the clinical discussion.";

const PURPOSE_OBJECTIVES: Record<CallPurpose, { objective: string; questions: string[] }> = {
  follow_up_after_check_in: {
    objective: "Confirm reachability and whether human CHW follow-up is needed today.",
    questions: [
      "Are you reachable for a callback today?",
      "Do you need a human community health worker to call you back?",
      "Do you already have urgent in-person care plans?",
    ],
  },
  appointment_coordination: {
    objective: "Confirm visit scheduling or rescheduling and capture a callback window.",
    questions: [
      "Is your care visit still scheduled?",
      "Do you need to reschedule?",
      "What callback window works best?",
    ],
  },
  callback_confirmation: {
    objective: "Confirm a previously arranged human callback still works.",
    questions: [
      "Does the previously arranged callback time still work?",
      "If not, what window is better?",
    ],
  },
};

export function buildCallPlan(input: {
  recipientE164: string;
  purpose: CallPurpose;
  callLanguage: string;
}): CallPlan {
  const spec = PURPOSE_OBJECTIVES[input.purpose];
  const opening =
    "Disclose that you are an automated assistant calling on behalf of Call Aunty care coordination.";

  const taskText = [
    opening,
    ESCALATION,
    `Speak in ${input.callLanguage}.`,
    `Call ${input.recipientE164}.`,
    spec.objective,
    `Ask at most ${spec.questions.length + 1} short logistical questions:`,
    ...spec.questions.map((q, i) => `${i + 1}. ${q}`),
    "Return only the structured fields requested by the schema.",
    `Do not discuss: ${PROHIBITED.join(", ")}.`,
  ].join(" ");

  assertSafeCallContent(taskText);

  return {
    opening,
    objective: spec.objective,
    boundedQuestions: spec.questions,
    prohibitedTopics: PROHIBITED,
    escalationLanguage: ESCALATION,
    desiredOutputs: [
      "reached",
      "availability",
      "needsHumanFollowUp",
      "safetyEscalation",
      "summaryCode",
      "nextAction",
    ],
    taskText,
  };
}

/** Back-compat alias used by adapter/policy. */
export function buildFollowUpTask(input: {
  recipientE164: string;
  purpose: CallPurpose;
  callLanguage: string;
}): string {
  return buildCallPlan(input).taskText;
}
