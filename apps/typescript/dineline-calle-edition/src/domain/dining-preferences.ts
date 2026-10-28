import { createHash } from "node:crypto";

import { z } from "zod";
import { calleVerificationFields } from "./call-result.js";

import {
  LocalDateSchema,
  LocalTimeSchema,
  TimeZoneSchema,
} from "./date-time.js";

const e164Phone = /^\+[1-9]\d{7,14}$/;

export const DiningBudgetSchema = z.enum([
  "budget",
  "moderate",
  "upscale",
  "no_preference",
  "unknown",
]);

export const DiningPreferencesSchema = z
  .object({
    location: z.string().trim().min(2).max(160).nullable(),
    cuisine: z.string().trim().min(2).max(120).nullable(),
    date: LocalDateSchema.nullable(),
    time: LocalTimeSchema.nullable(),
    timeZone: TimeZoneSchema.nullable(),
    partySize: z.number().int().min(1).max(20).nullable(),
    budget: DiningBudgetSchema,
    atmosphere: z.string().trim().min(1).max(240).nullable(),
    dietaryNeeds: z.array(z.string().trim().min(1).max(120)).max(12),
    notes: z.string().trim().max(500).nullable(),
  })
  .strict();

export type DiningPreferences = z.output<typeof DiningPreferencesSchema>;

export const diningPreferencesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...Object.keys(calleVerificationFields),
    "location",
    "cuisine",
    "date",
    "time",
    "time_zone",
    "party_size",
    "budget",
    "atmosphere",
    "dietary_needs",
    "notes",
  ],
  properties: {
    ...calleVerificationFields,
    location: {
      type: "string",
      description: "Requested city or neighborhood. Use unknown if it was not provided.",
    },
    cuisine: {
      type: "string",
      description: "Requested cuisine. Use unknown if it was not provided.",
    },
    date: {
      type: "string",
      description: "Requested date as YYYY-MM-DD. Use unknown if it was not provided.",
    },
    time: {
      type: "string",
      description: "Requested local time as 24-hour HH:MM. Use unknown if it was not provided.",
    },
    time_zone: {
      type: "string",
      description: "IANA time zone for the requested location. Use unknown if it is unclear.",
    },
    party_size: {
      type: "integer",
      description: "Number of diners. Use 0 if it was not provided.",
    },
    budget: {
      type: "string",
      enum: ["budget", "moderate", "upscale", "no_preference", "unknown"],
      description: "Best matching budget category. Use unknown when the call did not establish one.",
    },
    atmosphere: {
      type: "string",
      description: "The room or mood the diner wants. Use unknown if it was not provided.",
    },
    dietary_needs: {
      type: "string",
      description: 'A JSON-encoded array of dietary needs, such as ["no peanuts"]. Use [] when none were stated.',
    },
    notes: {
      type: "string",
      description: "Other useful preferences. Use none when there are no additional notes.",
    },
  },
} as const;

export function normalizeDiningPreferencesResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const partySize = value.party_size ?? value.partySize;
  let dietaryNeeds = value.dietary_needs ?? value.dietaryNeeds;
  if (typeof dietaryNeeds === "string") {
    try {
      dietaryNeeds = JSON.parse(dietaryNeeds);
    } catch {
      // Leave malformed wire data invalid so the verifier asks the user for input.
    }
  }
  return {
    location: nullableWireString(value.location),
    cuisine: nullableWireString(value.cuisine),
    date: nullableWireString(value.date),
    time: nullableWireString(value.time),
    timeZone: nullableWireString(value.time_zone ?? value.timeZone),
    partySize:
      Number.isInteger(partySize) &&
      typeof partySize === "number" &&
      partySize >= 1 &&
      partySize <= 20
        ? partySize
        : null,
    budget: DiningBudgetSchema.safeParse(value.budget).success
      ? value.budget
      : "unknown",
    atmosphere: nullableWireString(value.atmosphere),
    dietaryNeeds: Array.isArray(dietaryNeeds)
      ? dietaryNeeds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12)
      : dietaryNeeds,
    notes: nullableWireString(value.notes),
  };
}

export const PreferenceIntakeRequestSchema = z
  .object({
    phone: z.string().regex(e164Phone, "Use an E.164 phone number"),
    sessionId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
    explicitConsent: z.literal(true),
  })
  .strict();

export type PreferenceIntakeRequest = z.output<
  typeof PreferenceIntakeRequestSchema
>;

export const ApprovedPreferenceIntakeContractSchema =
  PreferenceIntakeRequestSchema.extend({
    contractVersion: z.literal("1.0"),
    requestId: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().regex(/^dineline_[a-f0-9]{48}$/),
    requestedAt: z.string().datetime(),
  }).strict();

export type ApprovedPreferenceIntakeContract = Readonly<
  z.output<typeof ApprovedPreferenceIntakeContractSchema>
>;

export const requiredPreferenceFields = [
  "location",
  "cuisine",
  "date",
  "time",
  "partySize",
] as const;

export type RequiredPreferenceField = (typeof requiredPreferenceFields)[number];

export function createPreferenceIntakeContract(
  input: PreferenceIntakeRequest,
  requestedAt = new Date().toISOString(),
): ApprovedPreferenceIntakeContract {
  const request = PreferenceIntakeRequestSchema.parse(input);
  const requestId = createHash("sha256")
    .update(
      JSON.stringify({
        contractVersion: "1.0",
        purpose: "dining-preference-intake",
        phone: request.phone,
        sessionId: request.sessionId,
        explicitConsent: request.explicitConsent,
      }),
    )
    .digest("hex");

  return deepFreeze(
    ApprovedPreferenceIntakeContractSchema.parse({
      contractVersion: "1.0",
      requestId,
      idempotencyKey: `dineline_${requestId.slice(0, 48)}`,
      requestedAt,
      ...request,
    }),
  );
}

export function missingPreferenceFields(
  preferences: DiningPreferences,
): RequiredPreferenceField[] {
  return requiredPreferenceFields.filter(
    (field) => preferences[field] === null,
  );
}

export function maskIntakePhone(phone: string): string {
  return `${phone.slice(0, 2)}******${phone.slice(-4)}`;
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value;
}
