import { createHash } from "node:crypto";

import { z } from "zod";

import {
  LocalDateSchema,
  LocalTimeSchema,
  TimeZoneSchema,
} from "./date-time.js";

const e164Phone = /^\+[1-9]\d{7,14}$/;

export const BookingDraftSchema = z
  .object({
    restaurant: z
      .object({
        name: z.string().trim().min(1).max(160),
        address: z.string().trim().min(1).max(240),
        phone: z.string().regex(e164Phone, "Use an E.164 phone number"),
      })
      .strict(),
    reservation: z
      .object({
        date: LocalDateSchema,
        time: LocalTimeSchema,
        timeZone: TimeZoneSchema,
        partySize: z.number().int().min(1).max(20),
        guestName: z.string().trim().min(1).max(100),
        specialRequests: z.string().trim().max(500).default(""),
      })
      .strict(),
    policy: z
      .object({
        acceptAlternativeTime: z.literal(false).default(false),
        leaveVoicemail: z.literal(false).default(false),
        discloseAiCaller: z.literal(true).default(true),
      })
      .strict()
      .default({
        acceptAlternativeTime: false,
        leaveVoicemail: false,
        discloseAiCaller: true,
      }),
  })
  .strict();

export type BookingDraft = z.input<typeof BookingDraftSchema>;

export const ApprovedBookingContractSchema = BookingDraftSchema.extend({
  contractVersion: z.literal("1.0"),
  contractId: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().regex(/^dineline_[a-f0-9]{48}$/),
  approvedAt: z.string().datetime(),
}).strict();

export type ApprovedBookingContract = Readonly<
  z.output<typeof ApprovedBookingContractSchema>
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
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

export function createApprovedBookingContract(
  input: BookingDraft,
  approvedAt = new Date().toISOString(),
): ApprovedBookingContract {
  const draft = BookingDraftSchema.parse(input);
  const fingerprintPayload = canonicalize({
    contractVersion: "1.0",
    ...draft,
  });
  const contractId = createHash("sha256")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex");

  return deepFreeze(
    ApprovedBookingContractSchema.parse({
      contractVersion: "1.0",
      contractId,
      idempotencyKey: `dineline_${contractId.slice(0, 48)}`,
      approvedAt,
      ...draft,
    }),
  );
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 2)}******${phone.slice(-4)}`;
}
