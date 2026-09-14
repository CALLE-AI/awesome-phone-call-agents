// JSON Schemas handed to CALL-E. These are the contract between the conversation and the code.
//
// CALL-E feeds every `description` to its extraction model, so the descriptions carry the
// enum-selection rules. Hard validation comes only from type, required, enum and
// additionalProperties. Unsupported keywords ($ref, oneOf, anyOf, allOf, additionalProperties: true)
// are rejected by `assertSupportedSchema` before a request is built.

import type { JsonObject } from "@call-e/calle";

export const SYMPTOMS = [
  "dizziness",
  "headache",
  "nausea",
  "cramps",
  "confusion",
  "faint",
  "hot_dry_skin",
  "breathing_difficulty",
  "chest_pain",
  "none",
] as const;

export const NEEDS = [
  "water",
  "fan_or_ac",
  "ride_to_cooling_center",
  "medication",
  "food",
  "power_for_medical_device",
  "someone_to_visit",
  "none",
] as const;

/** Extracted independently for every recipient in a wave. */
export const RECIPIENT_RESULT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["call_outcome", "answered_by", "is_cool", "hydrated", "symptoms", "confusion_suspected", "needs", "tier", "notes"],
  properties: {
    call_outcome: {
      type: "string",
      enum: ["completed", "declined_now", "cut_short", "voicemail", "no_person"],
      description:
        "How far the conversation got. Use completed when the questions were asked and answered. Use declined_now when a person answered but said it was not a good time or asked not to continue; in that case still fill every other field, using unknown, empty lists, tier yellow and a note saying they asked to be called later. Use cut_short when the line dropped or the person stopped responding before the questions were finished. Use voicemail when voicemail answered. Use no_person when nobody identifiable spoke.",
    },
    answered_by: {
      type: "string",
      enum: ["person", "other_person", "voicemail", "ivr", "unknown"],
      description:
        "Who answered. Use person when the registered person themself spoke. Use other_person when a relative, caregiver or neighbour answered and spoke for them. Use voicemail if voicemail picked up. Use ivr for an automated system. Use unknown if nobody clearly identifiable answered.",
    },
    is_cool: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only if the person says they are in a cool or shaded place AND a fan or air conditioner is working. Use no if the home is hot, the fan or AC is broken or off, or they are outdoors in the sun. Use unknown if this was not clearly established or the question was never asked.",
    },
    hydrated: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use yes only if the person says they have been drinking water today. Use no if they say they have not. Use unknown if not clearly established or the question was never asked.",
    },
    symptoms: {
      type: "array",
      description:
        "Every symptom the person or the answering caregiver reported. Use none only when they clearly said they feel fine. Use confusion when the person seemed disoriented or could not follow simple questions. Use hot_dry_skin when they say their skin feels hot and dry or that they have stopped sweating.",
      items: { type: "string", enum: [...SYMPTOMS] },
    },
    confusion_suspected: {
      type: "boolean",
      description:
        "true if the person seemed confused, disoriented, repeated themselves, or could not say what day it is when asked. false otherwise. This is a safety flag, not a diagnosis.",
    },
    needs: {
      type: "array",
      description:
        "Everything the person asked for or clearly needs. Use none only when they said they need nothing. Use someone_to_visit if they asked for a person to come by or seemed unable to look after themselves.",
      items: { type: "string", enum: [...NEEDS] },
    },
    tier: {
      type: "string",
      enum: ["green", "yellow", "red"],
      description:
        "red if confusion_suspected is true, or symptoms include confusion, faint, hot_dry_skin, breathing_difficulty or chest_pain, or the person asked for urgent help. yellow if is_cool is no, or hydrated is no, or any other symptom was reported, or any need other than none. green only if the person is cool, hydrated, reports no symptoms and needs nothing.",
    },
    notes: {
      type: "string",
      description: "One short sentence in English summarising the person's situation in their own words. No diagnosis, no advice.",
    },
  },
};

/** Extracted once per wave. CALL-E aggregates across recipients for us. */
export const TASK_RESULT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["green_count", "yellow_count", "red_count", "not_reached_count"],
  properties: {
    green_count: { type: "integer", description: "Number of recipients whose tier is green." },
    yellow_count: { type: "integer", description: "Number of recipients whose tier is yellow." },
    red_count: { type: "integer", description: "Number of recipients whose tier is red." },
    not_reached_count: {
      type: "integer",
      description: "Number of recipients where no person and no caregiver was spoken to (voicemail, no answer, automated system).",
    },
  },
};

/** Extracted from an escalation call to an emergency contact or volunteer. */
export const ESCALATION_RESULT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["reached", "will_check", "eta_minutes", "wants_emergency_services", "notes"],
  properties: {
    reached: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes if a human answered and understood the request. no for voicemail, wrong number or hang-up. unknown otherwise.",
    },
    will_check: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "yes only if the contact clearly committed to going to check on the person or to phoning them right now. no if they declined or cannot. unknown for a vague answer such as maybe or later.",
    },
    eta_minutes: {
      type: "integer",
      description: "How many minutes until the contact expects to reach the person. Use 0 if they did not commit or gave no time.",
    },
    wants_emergency_services: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes if the contact asked for an ambulance or emergency services to be sent. no if they did not. unknown if unclear.",
    },
    notes: { type: "string", description: "One short sentence in English on what the contact said." },
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

assertSupportedSchema(RECIPIENT_RESULT_SCHEMA, "recipient_result_schema");
assertSupportedSchema(TASK_RESULT_SCHEMA, "result_schema");
assertSupportedSchema(ESCALATION_RESULT_SCHEMA, "escalation_result_schema");
