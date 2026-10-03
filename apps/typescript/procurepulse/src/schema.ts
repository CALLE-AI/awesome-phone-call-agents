/**
 * The per-supplier extraction contract sent to CALL-E as `recipient_result_schema`.
 *
 * Descriptions steer the extraction; `type`, `enum`, `required` and
 * `additionalProperties: false` are what CALL-E enforces. Number-like fields stay strings so
 * a vague answer can be recorded as said instead of being forced into a number: turning it
 * into arithmetic is the ranking step's decision, not the model's.
 *
 * CALL-E rejects reserved recipient field names (`summary`, `status`, `transcript`,
 * `call_id`, timing fields) before dialing, so none are used here.
 */
export const QUOTE_FIELDS = [
  "reached",
  "item_match",
  "available_quantity",
  "unit",
  "unit_price",
  "currency",
  "extra_fees",
  "fulfillment_method",
  "ready_at",
  "quote_expires_at",
  "contact_name",
  "conditions",
  "certainty",
] as const;

export type QuoteField = (typeof QUOTE_FIELDS)[number];
export type QuoteResult = Record<QuoteField, string>;

export const quoteResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [...QUOTE_FIELDS],
  properties: {
    reached: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "yes only if someone at the supplier answered and discussed the request. no for voicemail, no answer, or a wrong number.",
    },
    item_match: {
      type: "string",
      enum: ["exact", "substitute", "unavailable", "unknown"],
      description:
        "exact if they can supply the requested item as specified. substitute if they offered a different, named item. unavailable if they cannot supply it by the deadline.",
    },
    available_quantity: {
      type: "string",
      description: "Quantity they can supply by the deadline, digits only (e.g. '20' or '12.5'). Empty string if they gave no number.",
    },
    unit: {
      type: "string",
      description: "Unit for the quantity and the price exactly as stated, e.g. 'kg', 'lb', 'each', 'case'. Empty string if unclear.",
    },
    unit_price: {
      type: "string",
      description:
        "Firm price per unit as a plain decimal without a currency symbol, e.g. '14.50'. Empty string if no firm price was given; put 'about' or 'depends' wording in conditions instead.",
    },
    currency: {
      type: "string",
      description: "ISO 4217 code such as 'USD'. Empty string if unknown.",
    },
    extra_fees: {
      type: "string",
      description: "Total delivery or other fees as a plain decimal, '0' only if they said there are no fees. Empty string if fees were not stated.",
    },
    fulfillment_method: {
      type: "string",
      enum: ["pickup", "delivery", "either", "unknown"],
      description: "How the buyer would receive the item.",
    },
    ready_at: {
      type: "string",
      description:
        "When the order would be ready for pickup or delivered, as an ISO 8601 date-time with UTC offset when a specific time was given (use the date and time zone from the task). Otherwise their words, or an empty string.",
    },
    quote_expires_at: {
      type: "string",
      description:
        "Until when the quoted price holds, as an ISO 8601 date-time with UTC offset when a specific time was given. Otherwise their words, or an empty string.",
    },
    contact_name: {
      type: "string",
      description: "Name of the person who gave the quote. Empty string if not given.",
    },
    conditions: {
      type: "string",
      description: "Every condition or caveat on price, quantity or timing in the supplier's words, including tax. 'None stated' if there were none.",
    },
    certainty: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"],
      description: "How firm the answers were. high for explicit firm figures, low for guesses, ranges or hedged answers.",
    },
  },
} as const;

const HOLD_FIELDS = ["reached", "hold_placed", "hold_expires_at", "contact_name", "notes"] as const;
export type HoldResult = Record<(typeof HOLD_FIELDS)[number], string>;

/** Sent only with the separate, human-approved hold call. */
export const holdResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [...HOLD_FIELDS],
  properties: {
    reached: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes only if someone at the supplier answered and discussed the hold.",
    },
    hold_placed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes only if the supplier explicitly agreed to set the stock aside without a purchase.",
    },
    hold_expires_at: {
      type: "string",
      description:
        "When the hold lapses, as an ISO 8601 date-time with UTC offset when a specific time was given. Otherwise their words, or an empty string.",
    },
    contact_name: {
      type: "string",
      description: "Name of the person who agreed or declined. Empty string if not given.",
    },
    notes: {
      type: "string",
      description: "One sentence on what was agreed, including that it is not a purchase if the supplier acknowledged that.",
    },
  },
} as const;

type ObjectSchema = {
  required: readonly string[];
  properties: Record<string, { type: string; enum?: readonly string[] }>;
};

/** Re-checks a provider result against the schema we sent: exact keys, strings, enum values. */
function validateAgainst(input: unknown, schema: ObjectSchema, label: string): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`CALL-E ${label} result is not an object`);
  const value = input as Record<string, unknown>;
  const unexpected = Object.keys(value).filter((key) => !(key in schema.properties));
  if (unexpected.length) throw new Error(`CALL-E ${label} result contains unexpected fields: ${unexpected.join(", ")}`);
  for (const field of schema.required) {
    const v = value[field];
    if (typeof v !== "string") throw new Error(`CALL-E ${label} result field ${field} must be a string`);
    const allowed = schema.properties[field]?.enum;
    if (allowed && !allowed.includes(v)) throw new Error(`CALL-E ${label} result field ${field} has an invalid enum value`);
  }
  return value as Record<string, string>;
}

export const validateQuoteResult = (input: unknown): QuoteResult =>
  validateAgainst(input, quoteResultSchema, "quote") as QuoteResult;

export const validateHoldResult = (input: unknown): HoldResult =>
  validateAgainst(input, holdResultSchema, "hold") as HoldResult;
