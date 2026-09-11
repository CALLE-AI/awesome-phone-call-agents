import { z } from "zod";
import type { CallStructuredResult } from "./types";

/**
 * The JSON Schema CALL-E is asked to validate extraction against.
 * Strict object, enums with `unknown`, one evidence field — following CALL-E's
 * documented best practices for reliable structured results.
 */
export const CALL_E_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "line_outcome",
    "accepts_plan",
    "accepting_new_patients",
    "soonest_appointment_stated",
    "wait_estimate_days",
    "modality",
    "evidence_quote",
  ],
  properties: {
    line_outcome: {
      type: "string",
      enum: [
        "reached_staff",
        "voicemail",
        "ivr_dead_end",
        "disconnected",
        "wrong_entity",
        "declined",
        "unknown",
      ],
      description:
        "reached_staff if a person at the practice answered and engaged. voicemail if a recorded message answered. ivr_dead_end if the automated menu never reached a person. disconnected if the number is not in service. wrong_entity if the number belongs to a different organization or person than the one we asked for. declined if a person answered but refused to answer our questions. unknown if the call ended without enough evidence.",
    },
    accepts_plan: {
      type: "string",
      enum: ["yes", "no", "out_of_network_only", "unknown"],
      description:
        "yes if the practice confirmed they accept the named insurance plan. out_of_network_only if they only see patients out of network for that plan. unknown if the question was not answered.",
    },
    accepting_new_patients: {
      type: "string",
      enum: ["yes", "no", "waitlist_only", "unknown"],
      description:
        "yes if they are taking new patients. waitlist_only if they keep a waitlist. no if they are not accepting. unknown if not answered.",
    },
    soonest_appointment_stated: {
      type: "string",
      description:
        "The soonest appointment date or timeframe the practice stated in plain words, or an empty string if none was given.",
    },
    wait_estimate_days: {
      type: "number",
      description:
        "Estimated number of days until the soonest appointment as stated. -1 when no estimate was given.",
    },
    modality: {
      type: "string",
      enum: ["in_person", "telehealth", "both", "unknown"],
      description:
        "in_person if only in-office care is offered. telehealth if only virtual. both if either. unknown if not stated.",
    },
    evidence_quote: {
      type: "string",
      description:
        "A short verbatim quote from the call supporting these answers. Empty string if nothing quotable.",
    },
  },
} as const;

const lineOutcome = z.enum([
  "reached_staff",
  "voicemail",
  "ivr_dead_end",
  "disconnected",
  "wrong_entity",
  "declined",
  "unknown",
]);

const acceptsPlan = z.enum(["yes", "no", "out_of_network_only", "unknown"]);
const acceptingNew = z.enum(["yes", "no", "waitlist_only", "unknown"]);
const modality = z.enum(["in_person", "telehealth", "both", "unknown"]);

export const structuredResultSchema = z
  .object({
    line_outcome: lineOutcome,
    accepts_plan: acceptsPlan,
    accepting_new_patients: acceptingNew,
    soonest_appointment_stated: z.string().default(""),
    wait_estimate_days: z.number().default(-1),
    modality: modality,
    evidence_quote: z.string().default(""),
  })
  .strict();

/**
 * Parse an unknown structured result from CALL-E into a typed result.
 * Returns null when the object is not schema-valid so callers can treat it
 * as an unverifiable outcome rather than crash.
 */
export function parseStructuredResult(input: unknown): CallStructuredResult | null {
  const parsed = structuredResultSchema.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
}
