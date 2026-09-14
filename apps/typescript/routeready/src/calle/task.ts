import type { JsonObject } from "@call-e/calle";

/**
 * Per-recipient result CALL-E extracts after each readiness call.
 * Uses only the schema features CALL-E supports (type, properties, required,
 * enum, description, additionalProperties: false) and no reserved field names.
 */
export const READINESS_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "reached_recipient",
    "readiness",
    "ready_clock_time",
    "handoff",
    "cod_cash_ready",
    "landmark",
    "customer_quote",
    "quote_in_english",
  ],
  properties: {
    reached_recipient: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "yes only when the person who answered confirms they are the customer for this order or can speak for them. no for a wrong number, voicemail, or no answer. unknown when unclear.",
    },
    readiness: {
      type: "string",
      enum: ["ready_now", "within_15_min", "15_to_45_min", "later_today", "not_today", "unknown"],
      description:
        "When the customer said they can receive the parcel. ready_now if they can receive it when the rider arrives. within_15_min or 15_to_45_min if they need that much extra time after the rider's expected arrival. later_today if they asked for a later time today. not_today if they cannot receive it today. unknown if they did not clearly say.",
    },
    ready_clock_time: {
      type: "string",
      description:
        "If the customer named a clock time when they can receive the parcel (for example 1 PM or 13:30), that time in 24-hour HH:MM form. Empty string otherwise.",
    },
    handoff: {
      type: "string",
      enum: ["in_person", "guard_or_neighbor", "none", "unknown"],
      description:
        "Who will receive the parcel: in_person if the customer will, guard_or_neighbor if they named a guard, neighbour or family member who can, none if nobody can, unknown if not discussed.",
    },
    cod_cash_ready: {
      type: "string",
      enum: ["yes", "no", "not_applicable", "unknown"],
      description: "Whether the cash-on-delivery amount will be ready. not_applicable if the order is prepaid. unknown if not discussed.",
    },
    landmark: {
      type: "string",
      description: "Directions or a landmark the customer gave to find their door, in their words. Empty string if none.",
    },
    customer_quote: {
      type: "string",
      description:
        "The customer's own words about when they can receive the parcel, quoted from the call in the language they spoke. Empty string if they did not say. Never paraphrase or invent.",
    },
    quote_in_english: {
      type: "string",
      description:
        "English translation of customer_quote. The same text when the customer spoke English. Empty string when customer_quote is empty.",
    },
  },
};

export interface ReadinessTaskInput {
  merchant: string;
  orderRef: string;
  etaMinutes: number;
  /** Amount due at the door, for example "1,250 taka"; null when prepaid. */
  codAmount: string | null;
  language: string;
  /** Tells the callee no real parcel is coming. */
  testCall?: boolean;
}

export function buildReadinessTask(input: ReadinessTaskInput): string {
  const lines = [
    `You are an AI assistant calling on behalf of ${input.merchant} about a parcel delivery. Say in your first sentence that you are an AI assistant calling about their delivery.`,
    `Speak ${input.language}, slowly and clearly.`,
  ];
  if (input.testCall) {
    lines.push("Tell them this is a test call for a delivery app and that no real parcel is coming, then continue with the questions.");
  }
  lines.push(
    `The rider expects to arrive with order ${input.orderRef} in about ${input.etaMinutes} minutes.`,
    "Ask: 1) whether they can receive the parcel when the rider arrives, and if not, how many extra minutes they need or whether later today works;",
    "2) if they will not be there, whether a guard, neighbour or family member can receive it;",
    input.codAmount
      ? `3) whether the cash payment of ${input.codAmount} will be ready;`
      : "3) do not discuss payment, this order is prepaid;",
    "4) a landmark near their door that helps the rider find it.",
    "Do not ask for card, bank, password or identity details. Do not promise an exact delivery time. If it is a wrong number or voicemail, apologise and end the call.",
    "Keep the call under 90 seconds, thank them, and end the call.",
  );
  return lines.join("\n");
}
