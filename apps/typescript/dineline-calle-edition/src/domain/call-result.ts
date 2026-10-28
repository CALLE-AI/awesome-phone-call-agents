import { z } from "zod";

import { LocalDateSchema, LocalTimeSchema } from "./date-time.js";

export const BookingOutcomeNameSchema = z.enum([
  "confirmed",
  "unavailable",
  "alternative_offered",
  "unreached",
  "uncertain",
]);

export type BookingOutcomeName = z.infer<typeof BookingOutcomeNameSchema>;

export const CalleStructuredResultSchema = z
  .object({
    outcome: BookingOutcomeNameSchema,
    confirmedDate: LocalDateSchema.nullable(),
    confirmedTime: LocalTimeSchema.nullable(),
    confirmedPartySize: z.number().int().positive().nullable(),
    confirmationCode: z.string().nullable(),
    alternativeDate: LocalDateSchema.nullable(),
    alternativeTime: LocalTimeSchema.nullable(),
    notes: z.string(),
  })
  .strict();

export type CalleStructuredResult = z.infer<
  typeof CalleStructuredResultSchema
>;

export const calleVerificationFields = {
  task_completed: {
    type: "boolean",
    description: "Whether the requested task was explicitly completed. Use false when evidence is insufficient.",
  },
  completion_confidence: {
    type: "number",
    description: "Evidence-based confidence between 0 and 1. Use 0 when the outcome is unknown.",
  },
  evidence: {
    type: "string",
    description: "One exact transcript quote supporting the result, or an empty string when there is no supporting quote.",
  },
  summary: {
    type: "string",
    description: "A short summary supported by the recorded conversation.",
  },
} as const;

export const calleResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...Object.keys(calleVerificationFields),
    "outcome",
    "confirmed_date",
    "confirmed_time",
    "confirmed_party_size",
    "confirmation_code",
    "alternative_date",
    "alternative_time",
    "notes",
  ],
  properties: {
    ...calleVerificationFields,
    outcome: {
      type: "string",
      enum: [
        "confirmed",
        "unavailable",
        "alternative_offered",
        "unreached",
        "uncertain",
      ],
    },
    confirmed_date: {
      type: "string",
      description: "Confirmed date as YYYY-MM-DD. Use unknown when no reservation was confirmed.",
    },
    confirmed_time: {
      type: "string",
      description: "Confirmed local time as 24-hour HH:MM. Use unknown when no reservation was confirmed.",
    },
    confirmed_party_size: {
      type: "integer",
      description: "Confirmed party size. Use 0 when no reservation was confirmed.",
    },
    confirmation_code: {
      type: "string",
      description: "Restaurant confirmation code. Use none if no code was given.",
    },
    alternative_date: {
      type: "string",
      description: "Alternative date as YYYY-MM-DD. Use unknown if none was offered.",
    },
    alternative_time: {
      type: "string",
      description: "Alternative local time as 24-hour HH:MM. Use unknown if none was offered.",
    },
    notes: {
      type: "string",
      description: "Short evidence-grounded outcome note.",
    },
  },
} as const;

export function normalizeCalleStructuredResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const partySize = value.confirmed_party_size ?? value.confirmedPartySize;
  return {
    outcome: value.outcome,
    confirmedDate: nullableWireString(value.confirmed_date ?? value.confirmedDate),
    confirmedTime: nullableWireString(value.confirmed_time ?? value.confirmedTime),
    confirmedPartySize:
      Number.isInteger(partySize) &&
      typeof partySize === "number" &&
      partySize > 0
        ? partySize
        : null,
    confirmationCode: nullableWireString(value.confirmation_code ?? value.confirmationCode),
    alternativeDate: nullableWireString(value.alternative_date ?? value.alternativeDate),
    alternativeTime: nullableWireString(value.alternative_time ?? value.alternativeTime),
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

export interface VerifiedBookingOutcome {
  outcome: BookingOutcomeName;
  providerCallId: string | null;
  confidence: number;
  summary: string;
  evidence: readonly string[];
  needsHumanReview: boolean;
  confirmationCode: string | null;
  alternativeDate: string | null;
  alternativeTime: string | null;
}

function nullableWireString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    /^(unknown|none|n\/a|not provided|not applicable|null)$/i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
