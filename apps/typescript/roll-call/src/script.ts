import type { Absence, Guardian, SchoolConfig } from "./types.js";

/**
 * The exact instruction CALL-E receives. Everything the voice agent is allowed
 * to say about the child is in this text; nothing else about the child exists
 * on the call. The school reviews this in preview before any live call.
 */
export function buildTask(absence: Absence, guardian: Guardian, school: SchoolConfig): string {
  const child = absence.firstName;
  const lines = [
    `Call ${guardian.name}, a parent or guardian of a student at ${school.schoolName}.`,
    `Speak in the language of locale ${guardian.locale}.`,
    "",
    `Open with exactly this disclosure before anything else: "Hello, this is an automated assistant calling on behalf of ${school.schoolName} about ${child}'s attendance today. This call is placed by an AI system and may be recorded."`,
    "",
    `Then ask whether you are speaking with ${guardian.name}.`,
    `If the person is NOT ${guardian.name}: do not say why you are calling beyond "it is about ${child}'s attendance". Ask them to have ${guardian.name} call the school office on ${school.officePhone}. Then end the call politely.`,
    `If it is voicemail: leave only this message: "This is an automated call from ${school.schoolName} about ${child}'s attendance today. Please call the school office on ${school.officePhone}." Do not say anything else.`,
    "",
    `If you are speaking with ${guardian.name}:`,
    `1. Say that ${child} (class ${absence.classLabel}) has been marked absent this morning and the school has not received a message about it.`,
    `2. Ask whether they were aware that ${child} is not at school.`,
    `3. If they were aware, ask briefly for the reason and when ${child} is expected back. Do not ask for medical details beyond a general reason.`,
    `4. If they were NOT aware, do not speculate, do not give advice, and do not suggest where the child might be. Say: "Thank you. I will pass this to the school office immediately so a member of staff can speak with you. You can also reach the office on ${school.officePhone}." Then end the call.`,
    "5. Ask whether they would like a member of staff to call them back.",
    "",
    `Rules: never disclose ${child}'s surname, address, timetable, or anything not stated above. Never confirm whether any other student is absent. Never accept or record a change of contact details on this call. Do not discuss anything unrelated to today's attendance. Be brief, calm, and courteous.`,
  ];
  return lines.join("\n");
}

/** Schema CALL-E validates its extraction against. Strict, enum-first, `unknown` everywhere. */
export const RESULT_SCHEMA = {
  type: "object",
  required: [
    "answered_by",
    "guardian_aware",
    "reason_category",
    "expected_return",
    "callback_requested",
    "guardian_words",
  ],
  properties: {
    answered_by: {
      type: "string",
      enum: ["guardian", "other_person", "voicemail", "no_answer", "unknown"],
      description:
        "Who the call reached. Use guardian only when the person confirmed being the named guardian. Use other_person when someone else answered. Use voicemail when a machine answered. Use no_answer when nobody picked up. Use unknown if the evidence is unclear.",
    },
    guardian_aware: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Whether the guardian said they already knew the child is not at school today. Use yes only when the guardian clearly said they knew. Use no only when the guardian clearly said they did not know. Use unknown in every other case, including when answered_by is not guardian.",
    },
    reason_category: {
      type: "string",
      enum: [
        "illness",
        "medical_appointment",
        "family",
        "transport",
        "on_the_way",
        "guardian_did_not_know",
        "other",
        "unknown",
      ],
      description:
        "The reason the guardian gave. Use on_the_way when the child is late but coming. Use guardian_did_not_know when guardian_aware is no. Use unknown when no reason was given or the guardian was not reached.",
    },
    expected_return: {
      type: "string",
      description:
        "When the guardian expects the child back at school, in the guardian's own words, or an empty string if not stated.",
    },
    callback_requested: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Whether the guardian asked for a member of staff to call them back. Use unknown if not discussed or the guardian was not reached.",
    },
    guardian_words: {
      type: "string",
      description:
        "A short verbatim quote of what the guardian said about whether they knew the child was absent, or an empty string if the guardian was not reached.",
    },
  },
  additionalProperties: false,
} as const;
