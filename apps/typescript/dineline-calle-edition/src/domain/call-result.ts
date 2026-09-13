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

export const calleResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "confirmedDate",
    "confirmedTime",
    "confirmedPartySize",
    "confirmationCode",
    "alternativeDate",
    "alternativeTime",
    "notes",
  ],
  properties: {
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
    confirmedDate: {
      type: "string",
      description: "Confirmed date as YYYY-MM-DD. Use unknown when no reservation was confirmed.",
    },
    confirmedTime: {
      type: "string",
      description: "Confirmed local time as 24-hour HH:MM. Use unknown when no reservation was confirmed.",
    },
    confirmedPartySize: {
      type: "integer",
      description: "Confirmed party size. Use 0 when no reservation was confirmed.",
    },
    confirmationCode: {
      type: "string",
      description: "Restaurant confirmation code. Use none if no code was given.",
    },
    alternativeDate: {
      type: "string",
      description: "Alternative date as YYYY-MM-DD. Use unknown if none was offered.",
    },
    alternativeTime: {
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

  return {
    outcome: value.outcome,
    confirmedDate: nullableWireString(value.confirmedDate),
    confirmedTime: nullableWireString(value.confirmedTime),
    confirmedPartySize:
      Number.isInteger(value.confirmedPartySize) &&
      typeof value.confirmedPartySize === "number" &&
      value.confirmedPartySize > 0
        ? value.confirmedPartySize
        : null,
    confirmationCode: nullableWireString(value.confirmationCode),
    alternativeDate: nullableWireString(value.alternativeDate),
    alternativeTime: nullableWireString(value.alternativeTime),
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
