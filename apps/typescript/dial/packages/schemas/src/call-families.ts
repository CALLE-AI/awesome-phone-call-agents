import { z } from 'zod';
import type { JsonSchema } from './calle-schema.js';
import type { TaskFamily } from './task.js';

/**
 * A "call family" is one shape of phone conversation: what CALL-E should find
 * out, and the schema it must return. Adding a domain means adding a family
 * here -- not a new application. This is the section 3 generalisation seam.
 */
export const CALL_FAMILY_IDS = [
  'repair_quote',
  'service_quote',
  'reservation',
  'appointment',
  'availability_check',
  'status_check',
  'general_inquiry',
] as const;
export type CallFamilyId = (typeof CALL_FAMILY_IDS)[number];

/** Tri-state used everywhere. `unknown` is a first-class answer, never coerced to a yes. */
const yesNoUnknown: JsonSchema = { type: 'string', enum: ['yes', 'no', 'unknown'] };
const zYesNoUnknown = z.enum(['yes', 'no', 'unknown']).catch('unknown');

/** Fields every family shares, so the evidence validator can work generically. */
const commonProps: Record<string, JsonSchema> = {
  business_name: { type: 'string', description: 'Business name as stated on the call.' },
  confidence: {
    type: 'string',
    enum: ['high', 'medium', 'low'],
    description: 'How confident you are that the answer is correct and complete.',
  },
  evidence_summary: {
    type: 'string',
    description: 'One or two sentences quoting what the person actually said. No inference.',
  },
};

const zCommon = {
  business_name: z.string().max(200).nullish(),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
  evidence_summary: z.string().max(2000).nullish(),
};

export interface CallFamily {
  id: CallFamilyId;
  /** Human label used in the UI. */
  label: string;
  resultSchema: JsonSchema;
  /** Parses CALL-E's structured_result. Returns null when it is unusable. */
  parse: (value: unknown) => Record<string, unknown> | null;
  /** Which field carries the comparable price, if any. */
  priceField: string | null;
  /** Which field says whether the business can actually help. */
  viabilityField: string | null;
  /**
   * Whether "no" on the viability field means *no answer was obtained*, rather
   * than *the answer is no*.
   *
   * The distinction is easy to miss and changes everything. `can_repair: "no"`
   * is a real answer -- this shop cannot fix it, and the user learned something.
   * `question_answered: "no"` is the opposite: nothing was learned at all.
   *
   * Reading the second as the first meant a call where the business said only
   * "Oui, Allô ?" and hung up was filed as a useful answer, counted towards
   * the comparison, and could be presented as the best verified option.
   */
  viabilityAsksWhetherAnswered?: boolean;
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

/* ------------------------------------------------------------------ repair */

const repairQuoteSchema = objectSchema(
  {
    ...commonProps,
    can_repair: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Can they perform this repair at all?' },
    device: { type: 'string', description: 'Device discussed, e.g. "iPhone 13".' },
    issue: { type: 'string', description: 'Fault discussed, e.g. "screen".' },
    quoted_price: { type: 'number', description: 'Total price quoted. Use 0 if none was given.' },
    currency: { type: 'string', description: 'ISO currency code of the quote, e.g. USD, EUR.' },
    price_includes_tax: yesNoUnknown,
    parts_quality: {
      type: 'string',
      enum: ['OEM', 'original_equivalent', 'aftermarket', 'unknown'],
    },
    turnaround: { type: 'string', description: 'How long the repair takes, as stated.' },
    same_day_available: yesNoUnknown,
    warranty: { type: 'string', description: 'Warranty offered, as stated.' },
    appointment_required: yesNoUnknown,
    quote_conditions: { type: 'string', description: 'Caveats attached to the quote.' },
  },
  ['can_repair', 'confidence', 'evidence_summary'],
);

const zRepairQuote = z.object({
  ...zCommon,
  can_repair: zYesNoUnknown,
  device: z.string().max(120).nullish(),
  issue: z.string().max(120).nullish(),
  quoted_price: z.coerce.number().nonnegative().nullish(),
  currency: z.string().max(8).nullish(),
  price_includes_tax: zYesNoUnknown,
  parts_quality: z.enum(['OEM', 'original_equivalent', 'aftermarket', 'unknown']).catch('unknown'),
  turnaround: z.string().max(200).nullish(),
  same_day_available: zYesNoUnknown,
  warranty: z.string().max(300).nullish(),
  appointment_required: zYesNoUnknown,
  quote_conditions: z.string().max(600).nullish(),
});

/* ----------------------------------------------------------------- service */

const serviceQuoteSchema = objectSchema(
  {
    ...commonProps,
    service_available: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Can they do this job?' },
    estimated_price: { type: 'number', description: 'Labour/job estimate. 0 if none given.' },
    callout_fee: { type: 'number', description: 'Separate callout or travel fee. 0 if none.' },
    currency: { type: 'string' },
    parts_included: yesNoUnknown,
    earliest_arrival: { type: 'string', description: 'Soonest they can attend, as stated.' },
    quote_binding: {
      type: 'string',
      enum: ['binding', 'estimate', 'unknown'],
      description: 'Is the figure a firm price or an estimate?',
    },
    additional_conditions: { type: 'string' },
  },
  ['service_available', 'confidence', 'evidence_summary'],
);

const zServiceQuote = z.object({
  ...zCommon,
  service_available: zYesNoUnknown,
  estimated_price: z.coerce.number().nonnegative().nullish(),
  callout_fee: z.coerce.number().nonnegative().nullish(),
  currency: z.string().max(8).nullish(),
  parts_included: zYesNoUnknown,
  earliest_arrival: z.string().max(200).nullish(),
  quote_binding: z.enum(['binding', 'estimate', 'unknown']).catch('unknown'),
  additional_conditions: z.string().max(600).nullish(),
});

/* ------------------------------------------------------------- reservation */

const reservationSchema = objectSchema(
  {
    ...commonProps,
    availability: {
      type: 'string',
      enum: ['available', 'unavailable', 'alternative_offered', 'unknown'],
    },
    date: { type: 'string', description: 'Date agreed, YYYY-MM-DD.' },
    time: { type: 'string', description: 'Time agreed, 24h HH:MM.' },
    party_size: { type: 'integer' },
    reservation_name: { type: 'string' },
    booking_made: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Was a reservation actually placed and confirmed?',
    },
    confirmation_code: { type: 'string' },
    special_conditions: { type: 'string' },
  },
  ['availability', 'booking_made', 'confidence', 'evidence_summary'],
);

const zReservation = z.object({
  ...zCommon,
  availability: z.enum(['available', 'unavailable', 'alternative_offered', 'unknown']).catch('unknown'),
  date: z.string().max(20).nullish(),
  time: z.string().max(20).nullish(),
  party_size: z.coerce.number().int().positive().nullish(),
  reservation_name: z.string().max(120).nullish(),
  booking_made: zYesNoUnknown,
  confirmation_code: z.string().max(80).nullish(),
  special_conditions: z.string().max(600).nullish(),
});

/* ------------------------------------------------------------- appointment */

const appointmentSchema = objectSchema(
  {
    ...commonProps,
    availability: {
      type: 'string',
      enum: ['available', 'unavailable', 'alternative_offered', 'unknown'],
    },
    date: { type: 'string' },
    time: { type: 'string' },
    booking_made: yesNoUnknown,
    confirmation_code: { type: 'string' },
    price_estimate: { type: 'number' },
    currency: { type: 'string' },
    requirements: { type: 'string', description: 'What the customer must bring or do.' },
  },
  ['availability', 'booking_made', 'confidence', 'evidence_summary'],
);

const zAppointment = z.object({
  ...zCommon,
  availability: z.enum(['available', 'unavailable', 'alternative_offered', 'unknown']).catch('unknown'),
  date: z.string().max(20).nullish(),
  time: z.string().max(20).nullish(),
  booking_made: zYesNoUnknown,
  confirmation_code: z.string().max(80).nullish(),
  price_estimate: z.coerce.number().nonnegative().nullish(),
  currency: z.string().max(8).nullish(),
  requirements: z.string().max(600).nullish(),
});

/* ------------------------------------------------------ availability check */

const availabilitySchema = objectSchema(
  {
    ...commonProps,
    available: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Is the thing asked about available?' },
    item: { type: 'string', description: 'What was asked about.' },
    price: { type: 'number' },
    currency: { type: 'string' },
    when_available: { type: 'string' },
    conditions: { type: 'string' },
  },
  ['available', 'confidence', 'evidence_summary'],
);

const zAvailability = z.object({
  ...zCommon,
  available: zYesNoUnknown,
  item: z.string().max(200).nullish(),
  price: z.coerce.number().nonnegative().nullish(),
  currency: z.string().max(8).nullish(),
  when_available: z.string().max(200).nullish(),
  conditions: z.string().max(600).nullish(),
});

/* ------------------------------------------------------------ status check */

const statusCheckSchema = objectSchema(
  {
    ...commonProps,
    status_known: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Did they tell you the status? "no" if they refused or could not say.',
    },
    reported_status: { type: 'string', description: 'The status exactly as stated.' },
    refused_reason: {
      type: 'string',
      description: 'If they would not say, why -- e.g. privacy policy, needs the patient to call.',
    },
    ready_for_collection: yesNoUnknown,
    next_step: { type: 'string' },
  },
  ['status_known', 'confidence', 'evidence_summary'],
);

const zStatusCheck = z.object({
  ...zCommon,
  status_known: zYesNoUnknown,
  reported_status: z.string().max(400).nullish(),
  refused_reason: z.string().max(400).nullish(),
  ready_for_collection: zYesNoUnknown,
  next_step: z.string().max(400).nullish(),
});

/* -------------------------------------------------------- generic fallback */

const generalInquirySchema = objectSchema(
  {
    ...commonProps,
    question_answered: yesNoUnknown,
    answer: { type: 'string', description: 'The answer given, in their words.' },
    conditions: { type: 'string' },
    next_step: { type: 'string' },
  },
  ['question_answered', 'confidence', 'evidence_summary'],
);

const zGeneralInquiry = z.object({
  ...zCommon,
  question_answered: zYesNoUnknown,
  answer: z.string().max(1500).nullish(),
  conditions: z.string().max(600).nullish(),
  next_step: z.string().max(400).nullish(),
});

function makeParser<T extends z.ZodTypeAny>(schema: T) {
  return (value: unknown): Record<string, unknown> | null => {
    // CALL-E returns null when it cannot produce a schema-valid result. That is
    // the honest "do not act" signal -- we propagate it rather than inventing.
    if (value === null || typeof value !== 'object') return null;
    const parsed = schema.safeParse(value);
    return parsed.success ? (parsed.data as Record<string, unknown>) : null;
  };
}

export const CALL_FAMILIES: Record<CallFamilyId, CallFamily> = {
  repair_quote: {
    id: 'repair_quote',
    label: 'Repair quote',
    resultSchema: repairQuoteSchema,
    parse: makeParser(zRepairQuote),
    priceField: 'quoted_price',
    viabilityField: 'can_repair',
  },
  service_quote: {
    id: 'service_quote',
    label: 'Service quote',
    resultSchema: serviceQuoteSchema,
    parse: makeParser(zServiceQuote),
    priceField: 'estimated_price',
    viabilityField: 'service_available',
  },
  reservation: {
    id: 'reservation',
    label: 'Reservation',
    resultSchema: reservationSchema,
    parse: makeParser(zReservation),
    priceField: null,
    viabilityField: 'availability',
  },
  appointment: {
    id: 'appointment',
    label: 'Appointment',
    resultSchema: appointmentSchema,
    parse: makeParser(zAppointment),
    priceField: 'price_estimate',
    viabilityField: 'availability',
  },
  availability_check: {
    id: 'availability_check',
    label: 'Availability',
    resultSchema: availabilitySchema,
    parse: makeParser(zAvailability),
    priceField: 'price',
    viabilityField: 'available',
  },
  status_check: {
    id: 'status_check',
    label: 'Status check',
    resultSchema: statusCheckSchema,
    parse: makeParser(zStatusCheck),
    priceField: null,
    viabilityField: 'status_known',
    viabilityAsksWhetherAnswered: true,
  },
  general_inquiry: {
    id: 'general_inquiry',
    label: 'Inquiry',
    resultSchema: generalInquirySchema,
    parse: makeParser(zGeneralInquiry),
    priceField: null,
    viabilityField: 'question_answered',
    viabilityAsksWhetherAnswered: true,
  },
};

/** Default family for a task family. The interpreter may override it. */
export const TASK_FAMILY_TO_CALL_FAMILY: Record<TaskFamily, CallFamilyId> = {
  research_compare: 'repair_quote',
  quote_request: 'service_quote',
  reservation: 'reservation',
  appointment: 'appointment',
  availability_check: 'availability_check',
  status_check: 'status_check',
  general_inquiry: 'general_inquiry',
  service_booking: 'appointment',
  other: 'general_inquiry',
};

export function getCallFamily(id: CallFamilyId): CallFamily {
  return CALL_FAMILIES[id];
}
