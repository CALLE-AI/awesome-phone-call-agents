// The JSON Schema handed to CALL-E: the contract between the conversation and the code.
//
// CALL-E feeds every `description` to its extraction model, so the descriptions carry the
// enum-selection rules. not_asked is separate from unknown on purpose: a question skipped because an
// earlier answer settled it is not the same as a question the person could not answer.

import type { JsonObject } from "@call-e/calle";
import { ASKABLE_CODES, type AskableCode } from "./types.js";

const ANSWER_ENUM = ["yes", "no", "unknown", "not_asked"];

const ANSWER_MEANING: Record<AskableCode, string> = {
  caregiver_child: "Takes care of a child aged 13 or younger.",
  pregnant_postpartum: "Pregnant now, or gave birth in the last year.",
  caregiver_disabled: "Takes care of a person with a disability.",
  medically_frail: "Has a health condition, a disability, or a mental health or substance use condition. Record the condition only; the limit on daily activities goes in frail_daily_limitation.",
  snap_tanf: "Currently gets SNAP food benefits or TANF cash assistance.",
  veteran_disability: "Veteran with a total disability rating from the VA.",
  sud_treatment: "Currently in a drug or alcohol treatment program.",
  former_foster_youth: "Was in foster care at age 18.",
};

export const SCREENING_RESULT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "call_outcome",
    "identity_confirmed",
    "aware_of_rule",
    "answers",
    "frail_daily_limitation",
    "monthly_hours",
    "income_band",
    "agent_told_them",
    "wants_navigator",
    "preferred_callback",
    "opt_out",
    "notes",
  ],
  properties: {
    call_outcome: {
      type: "string",
      enum: ["completed", "declined_now", "cut_short", "voicemail", "no_person", "wrong_person"],
      description:
        "How far the call got. completed: the screening questions were asked and answered. declined_now: the person confirmed who they are but said it was not a good time. cut_short: the line dropped or the person stopped responding before the screening was finished. voicemail: voicemail answered and only the neutral message was left. no_person: nobody identifiable spoke. wrong_person: someone else answered, or the birth year did not match.",
    },
    identity_confirmed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes only if the person said they are the named person AND gave the matching birth year. no if someone else answered or the year did not match. unknown otherwise.",
    },
    aware_of_rule: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "The person's answer to whether they had heard about the new Medicaid work rule before this call. unknown if the question was not asked.",
    },
    answers: {
      type: "object",
      additionalProperties: false,
      required: [...ASKABLE_CODES],
      description: "The person's answer to each exemption question. Use not_asked for every question you did not ask, including questions skipped because an earlier answer was yes.",
      properties: Object.fromEntries(
        ASKABLE_CODES.map((code) => [
          code,
          { type: "string", enum: ANSWER_ENUM, description: `${ANSWER_MEANING[code]} yes or no only if the person clearly said so; unknown if they were unsure; not_asked if the question was not asked.` },
        ]),
      ),
    },
    frail_daily_limitation: {
      type: "string",
      enum: ANSWER_ENUM,
      description: "Only when the person said yes to the health question: yes if they said it makes it hard to work or to do everyday activities, no if they said it does not, unknown if unclear. not_asked otherwise.",
    },
    monthly_hours: {
      type: "integer",
      description: "Hours per month of work, school, volunteering or job training the person reported, as a whole number. If they gave weekly hours, multiply by 4. Use -1 if not asked or not known.",
    },
    income_band: {
      type: "string",
      enum: ["under_580", "580_or_more", "unknown", "not_asked"],
      description: "Their answer to whether they earn more or less than about 580 dollars a month before taxes.",
    },
    agent_told_them: {
      type: "string",
      enum: ["may_qualify_exemption", "may_meet_requirement", "needs_help", "nothing"],
      description: "Which closing message you actually said. nothing if the call ended before you said one.",
    },
    wants_navigator: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Whether they want a free navigator to call them.",
    },
    preferred_callback: {
      type: "string",
      description: "The day and time they prefer for a navigator call, in their own words. Empty string if none.",
    },
    opt_out: {
      type: "string",
      enum: ["yes", "no"],
      description: "yes if they asked not to be called about this again.",
    },
    notes: {
      type: "string",
      description: "One short sentence in English about the situation. Never include a diagnosis, medication or any medical detail.",
    },
  },
};

const UNSUPPORTED_KEYWORDS = ["$ref", "oneOf", "anyOf", "allOf", "not", "patternProperties", "format"];

export function assertSupportedSchema(schema: JsonObject, path = "schema"): void {
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) {
      throw new Error(`${path}: CALL-E does not support the JSON Schema keyword ${key}`);
    }
    if (key === "additionalProperties" && value === true) {
      throw new Error(`${path}: CALL-E does not support additionalProperties: true`);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      assertSupportedSchema(value as JsonObject, `${path}.${key}`);
    }
  }
}

assertSupportedSchema(SCREENING_RESULT_SCHEMA, "recipient_result_schema");
