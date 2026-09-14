import { z } from 'zod';

/**
 * Business automation: the second orchestration mode.
 *
 * Consumer Dial discovers businesses and calls them. Business mode is the
 * mirror image: a business account owns workflows that call ITS customers --
 * reminders, callbacks, follow-ups -- through exactly the same CALL-E
 * provider and the same durable queue.
 *
 * The model is deliberately domain-agnostic. A dental clinic and a plumbing
 * company differ only in which template they picked and what context they
 * attach to a run. Nothing here branches on industry: templates are data,
 * not code paths.
 */

/* ------------------------------------------------------------- industries */

export const BUSINESS_INDUSTRIES = [
  'healthcare',
  'restaurant',
  'home_services',
  'professional_services',
  'beauty_wellness',
  'automotive',
  'retail',
  'other',
] as const;
export type BusinessIndustry = (typeof BUSINESS_INDUSTRIES)[number];

export const BUSINESS_INDUSTRY_LABELS: Record<BusinessIndustry, string> = {
  healthcare: 'Healthcare',
  restaurant: 'Restaurant / Hospitality',
  home_services: 'Home Services',
  professional_services: 'Professional Services',
  beauty_wellness: 'Beauty / Wellness',
  automotive: 'Automotive',
  retail: 'Retail',
  other: 'Other',
};

export const BUSINESS_STATUSES = ['active', 'paused'] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

/**
 * Outbound only.
 *
 * There was an 'inbound' direction here, backing an "AI front desk" template
 * that answered a business's own number. Nothing could ever implement it: the
 * CALL-E API is eight endpoints, every one of which starts from a recipient
 * Dial supplies, and it exposes no way to provision a number, bind one to an
 * agent, or receive an incoming call. Keeping the value modelled a capability
 * the provider does not have.
 */
export const WORKFLOW_DIRECTIONS = ['outbound'] as const;
export type WorkflowDirection = (typeof WORKFLOW_DIRECTIONS)[number];

/* --------------------------------------------------------- result schemas */

/**
 * Hand-written JSON Schemas sent to CALL-E, parsed back with Zod -- the same
 * discipline as the consumer call families. Booleans are never required of
 * the provider; absence means false.
 */

const APPOINTMENT_REMINDER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    outcome: {
      type: 'string',
      enum: ['confirmed', 'cancel_requested', 'reschedule_requested', 'no_answer', 'wrong_number', 'other'],
      description:
        'confirmed: they will keep the appointment. cancel_requested: they want to cancel. reschedule_requested: they want the office to contact them about a new time.',
    },
    requested_callback: {
      type: 'boolean',
      description: 'True when they asked the office to call or message them back.',
    },
    requested_time: { type: 'string', description: 'A time they proposed, verbatim, if any.' },
    note: { type: 'string', description: 'Anything else worth telling the office, in their words.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence_summary: { type: 'string' },
  },
  required: ['outcome', 'confidence', 'evidence_summary'],
} as const;

const LEAD_CALLBACK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    outcome: {
      type: 'string',
      enum: ['time_agreed', 'callback_requested', 'interested', 'not_interested', 'no_answer', 'wrong_number', 'other'],
      description:
        'time_agreed: a concrete date/time was agreed. callback_requested: they asked to be called again later. interested/not_interested: sentiment without a time.',
    },
    preferred_date: { type: 'string', description: 'Agreed or preferred date, e.g. 2026-08-26.' },
    preferred_time_window: { type: 'string', description: 'Agreed or preferred window, e.g. 14:00-16:00.' },
    note: { type: 'string', description: 'Details worth passing to the business, in their words.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence_summary: { type: 'string' },
  },
  required: ['outcome', 'confidence', 'evidence_summary'],
} as const;

const GENERAL_FOLLOWUP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    outcome: {
      type: 'string',
      enum: ['completed', 'not_interested', 'no_answer', 'wrong_number', 'other'],
      description: 'completed: the goal of the call was achieved.',
    },
    note: { type: 'string', description: 'What was established, in their words.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence_summary: { type: 'string' },
  },
  required: ['outcome', 'confidence', 'evidence_summary'],
} as const;

/**
 * Field names match the JSON Schemas sent to CALL-E exactly (snake_case), so
 * a provider response parses without translation. A missing boolean means
 * false; anything unparseable returns null, the honest "needs review".
 */
const appointmentReminderResultSchema = z.object({
  outcome: z.enum(['confirmed', 'cancel_requested', 'reschedule_requested', 'no_answer', 'wrong_number', 'other']),
  requested_callback: z.boolean().default(false),
  requested_time: z.string().max(200).nullable().default(null),
  note: z.string().max(500).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  evidence_summary: z.string().max(1000).nullable().default(null),
});
export type AppointmentReminderResult = z.infer<typeof appointmentReminderResultSchema>;

const leadCallbackResultSchema = z.object({
  outcome: z.enum(['time_agreed', 'callback_requested', 'interested', 'not_interested', 'no_answer', 'wrong_number', 'other']),
  preferred_date: z.string().max(40).nullable().default(null),
  preferred_time_window: z.string().max(40).nullable().default(null),
  note: z.string().max(500).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  evidence_summary: z.string().max(1000).nullable().default(null),
});
export type LeadCallbackResult = z.infer<typeof leadCallbackResultSchema>;

const generalFollowupResultSchema = z.object({
  outcome: z.enum(['completed', 'not_interested', 'no_answer', 'wrong_number', 'other']),
  note: z.string().max(500).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  evidenceSummary: z.string().max(1000).nullable().default(null),
});
export type GeneralFollowupResult = z.infer<typeof generalFollowupResultSchema>;

/* ------------------------------------------------- appointment wording */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Turns the stored `YYYY-MM-DDTHH:mm` into something worth saying out loud:
 * "Tuesday 25 August 2026 at 10:30".
 *
 * The date is read textually and the weekday derived through `Date.UTC`, so
 * no local timezone can shift it -- a reminder must never announce a
 * different day to the one the business picked, and a server in another zone
 * is not a reason for that to happen.
 *
 * Anything that is not that exact shape is returned unchanged: older runs
 * stored free text, and passing it through is better than dropping it.
 */
export function describeAppointment(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const [, y, m, d, hh, mm] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value.trim();
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year} at ${hh}:${mm}`;
}

/* --------------------------------------------- appointment field values */

/**
 * A date and a time are collected through two controls but stored as one
 * value, and the store has to be able to hold a HALF-filled answer.
 *
 * The first version could not. It composed to '' unless both halves were
 * present, and the inputs read their displayed value back out of that -- so
 * entering a date (which you can only do before entering a time) composed to
 * '', the controlled input reset itself, and what you typed vanished. Neither
 * box could ever keep anything.
 *
 * So a partial is representable: '2026-08-25T' is a date with no time yet,
 * 'T10:30' a time with no date. Only '' means nothing has been entered. The
 * inputs stay fully controlled with one source of truth and no local mirror,
 * and `isCompleteAppointment` is what decides whether the answer may be
 * submitted.
 */

/**
 * Splits a stored value into its two controls. Either half may be empty, and
 * either may be mid-typing -- this does not decide what is valid.
 *
 * Split on the separator rather than matched against a finished pattern.
 * Matching meant only a complete YYYY-MM-DD could be read back, which was
 * enough for the web -- an input[type=date] only ever emits a whole date --
 * and useless on a phone, which has no such control and types the date one
 * character at a time. "2026-0" matched nothing, so every keystroke read back
 * as empty and the field could never accumulate anything.
 */
export function splitAppointmentValue(value: string): [date: string, time: string] {
  const trimmed = value.trim();
  if (!trimmed) return ['', ''];
  // 'T' is the separator this writes; a space is tolerated because older runs
  // stored free text such as '2026-08-25 10:30 AM'.
  const at = trimmed.includes('T') ? trimmed.indexOf('T') : trimmed.indexOf(' ');
  if (at < 0) return [trimmed, ''];
  return [trimmed.slice(0, at), trimmed.slice(at + 1)];
}

/** Joins two controls back into one stored value, partials included. */
export function composeAppointmentValue(date: string, time: string): string {
  return date || time ? `${date}T${time}` : '';
}

/**
 * Both halves present AND real -- the only form that may reach the server.
 *
 * Shape alone is not enough. The phone collects this as typed text, so
 * pasting "25/08/2026" masks to "2508-20-26", which looks like a date and is
 * not one. Checking only the pattern let that through to the server, which
 * rejected it as an invalid date long after the point where the person could
 * see what was wrong. Month, day and clock ranges are checked here so the
 * button stays disabled and the field says what is missing.
 */
export function isCompleteAppointment(value: string): boolean {
  const [date, time] = splitAppointmentValue(value);
  // Shape first, because splitting no longer guarantees it: a half-typed
  // '2026-0' and a legacy '10:30 AM' both reach here now.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (!/^\d{2}:\d{2}$/.test(time)) return false;

  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59) return false;
  return true;
}

/** Real month lengths, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Keeps a typed date in `YYYY-MM-DD` shape, inserting the dashes.
 *
 * React Native has no native date input, so the phone collects this as text.
 * The separators are not left to whoever is typing: what goes in here ends up
 * being read out on a real call, and "25/08" versus "08/25" is the difference
 * between reminding someone about the right day and the wrong one.
 */
export function maskAppointmentDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
}

/** Keeps a typed time in 24-hour `HH:MM` shape. */
export function maskAppointmentTime(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

/* ------------------------------------------------------------------ goals */

/**
 * Goal builders. Stored business/contact text is UNTRUSTED: callers wrap
 * every interpolated value with sanitizeExternalText before this assembles
 * the final brief. What is written here is Dial's own instruction voice.
 */
export type BusinessBriefContext = {
  businessName: string;
  contactName: string;
  context: Record<string, string>;
};

interface TemplateDefinition {
  id: string;
  label: string;
  description: string;
  /** Which industries this template is recommended for. Advisory only. */
  industries: BusinessIndustry[];
  direction: WorkflowDirection;
  contextFields: Array<{
    id: string;
    label: string;
    type: 'datetime' | 'text';
    required: boolean;
    hint?: string;
  }>;
  resultJsonSchema: Record<string, unknown>;
  resultParser: (value: unknown) => Record<string, unknown> | null;
  outcomeLabels: Record<string, string>;
  /** Dial's own instruction lines. Never receives untrusted text directly. */
  goalLines: (input: BusinessBriefContext) => string[];
}

const APPOINTMENT_REMINDER: TemplateDefinition = {
  id: 'appointment_reminder',
  label: 'Appointment reminder',
  description: 'Remind a customer of an upcoming appointment and confirm, cancel, or offer a reschedule.',
  industries: ['healthcare', 'beauty_wellness', 'home_services', 'professional_services', 'automotive'],
  direction: 'outbound',
  contextFields: [
    { id: 'appointmentAt', label: 'Appointment date and time', type: 'datetime', required: true },
    {
      id: 'serviceName',
      label: 'Service or visit',
      type: 'text',
      required: false,
      hint: 'e.g. "hygiene appointment" -- optional',
    },
  ],
  resultJsonSchema: APPOINTMENT_REMINDER_JSON_SCHEMA,
  resultParser: (value) => parseOrNull(appointmentReminderResultSchema, value),
  outcomeLabels: {
    confirmed: 'Confirmed',
    cancel_requested: 'Cancel requested',
    reschedule_requested: 'Reschedule requested',
    no_answer: 'No answer',
    wrong_number: 'Wrong number',
    other: 'Other',
  },
  goalLines: ({ businessName, contactName, context }) => [
    `Call ${contactName} on behalf of ${businessName}.`,
    `Remind them of their appointment${context['serviceName'] ? ` (${context['serviceName']})` : ''} scheduled for ${context['appointmentAt'] ? describeAppointment(context['appointmentAt']) : 'the scheduled time'}.`,
    'Your goal is only to learn whether they:',
    '- confirm the appointment as scheduled;',
    '- want to cancel it;',
    '- or want the office to contact them to arrange a different time.',
    'Do not create, move, or cancel the appointment yourself. Do not discuss payment. Do not give advice of any kind; if they ask a question you cannot answer, say the office will follow up.',
  ],
};

const LEAD_CALLBACK: TemplateDefinition = {
  id: 'lead_callback',
  label: 'Customer callback',
  description: 'Call a lead or customer, gauge interest, and agree a good time for the business to reach them or visit.',
  industries: ['home_services', 'professional_services', 'automotive', 'retail'],
  direction: 'outbound',
  contextFields: [
    { id: 'service', label: 'What they enquired about', type: 'text', required: false },
  ],
  resultJsonSchema: LEAD_CALLBACK_JSON_SCHEMA,
  resultParser: (value) => parseOrNull(leadCallbackResultSchema, value),
  outcomeLabels: {
    time_agreed: 'Time agreed',
    callback_requested: 'Callback requested',
    interested: 'Interested',
    not_interested: 'Not interested',
    no_answer: 'No answer',
    wrong_number: 'Wrong number',
    other: 'Other',
  },
  goalLines: ({ businessName, contactName, context }) => [
    `Call ${contactName} on behalf of ${businessName}.${context['service'] ? ` They contacted ${businessName} about ${context['service']}.` : ''}`,
    'Find out whether they are still interested, and agree a specific day and time window for the business to call them back or visit.',
    'Do not promise pricing, discounts, or arrival times. Do not book work yourself; your job is to establish interest and availability only.',
  ],
};

const GENERAL_FOLLOWUP: TemplateDefinition = {
  id: 'general_followup',
  label: 'Custom phone job',
  description: 'Describe the goal in your own words; Dial calls each recipient and returns a structured outcome.',
  industries: [...BUSINESS_INDUSTRIES],
  direction: 'outbound',
  contextFields: [],
  resultJsonSchema: GENERAL_FOLLOWUP_JSON_SCHEMA,
  resultParser: (value) => parseOrNull(generalFollowupResultSchema, value),
  outcomeLabels: {
    completed: 'Completed',
    not_interested: 'Not interested',
    no_answer: 'No answer',
    wrong_number: 'Wrong number',
    other: 'Other',
  },
  // The workflow's own stored goal (sanitized by the caller) is appended.
  goalLines: ({ businessName, contactName }) => [
    `Call ${contactName} on behalf of ${businessName}.`,
  ],
};

const TEMPLATES: Record<string, TemplateDefinition> = {
  [APPOINTMENT_REMINDER.id]: APPOINTMENT_REMINDER,
  [LEAD_CALLBACK.id]: LEAD_CALLBACK,
  [GENERAL_FOLLOWUP.id]: GENERAL_FOLLOWUP,
};

export const BUSINESS_WORKFLOW_TEMPLATES = Object.values(TEMPLATES);

export function getBusinessTemplate(id: string): TemplateDefinition | null {
  return TEMPLATES[id] ?? null;
}

/**
 * Every template can be created; the list is no longer filtered.
 * Kept as a named function because the routes read better for it.
 */
export function listCreatableTemplates(): TemplateDefinition[] {
  return BUSINESS_WORKFLOW_TEMPLATES;
}

function parseOrNull<T>(schema: z.ZodType<T>, value: unknown): Record<string, unknown> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/** Recommended template ids for an industry. Purely advisory ordering for UI. */
export function recommendedTemplates(industry: string): string[] {
  return BUSINESS_WORKFLOW_TEMPLATES.filter((t) => t.industries.includes(industry as BusinessIndustry)).map(
    (t) => t.id,
  );
}

/* ------------------------------------------------------------------- dtos */

const hoursSchema = z.record(
  z.string(),
  z.array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })),
);

export const createBusinessRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.enum(BUSINESS_INDUSTRIES).default('other'),
  timezone: z.string().trim().min(1).max(60).default('UTC'),
  /**
   * ISO 3166-1 alpha-2 -- 'AE', not '+971'. It sets the default region for
   * parsing local numbers into E.164, and is not a dialling code.
   */
  country: z.string().trim().length(2).toUpperCase().nullable().default(null),
  /**
   * What the owner typed when they picked "Other". Advisory, exactly like
   * `industry`: it labels the business for a human and never branches code.
   */
  customIndustry: z.string().trim().max(80).nullable().default(null),
  locale: z.string().trim().min(2).max(20).default('en'),
  address: z.string().trim().max(400).nullable().default(null),
  website: z.string().trim().max(500).nullable().default(null),
  businessPhone: z.string().trim().max(30).nullable().default(null),
  hours: hoursSchema.nullable().default(null),
});
export type CreateBusinessRequest = z.infer<typeof createBusinessRequestSchema>;

export const updateBusinessRequestSchema = createBusinessRequestSchema.partial().extend({
  status: z.enum(BUSINESS_STATUSES).optional(),
});

export const businessDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.enum(BUSINESS_INDUSTRIES),
  /** The owner's own words when industry is 'other'; null otherwise. */
  customIndustry: z.string().nullable(),
  /** What to show a person: the custom text when there is one. */
  industryLabel: z.string(),
  timezone: z.string(),
  country: z.string().nullable(),
  locale: z.string(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  businessPhone: z.string().nullable(),
  status: z.enum(BUSINESS_STATUSES),
  hours: hoursSchema.nullable(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string(),
});
export type BusinessDto = z.infer<typeof businessDtoSchema>;

export const callingHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23).default(9),
  endHour: z.number().int().min(1).max(24).default(19),
});
export type CallingHours = z.infer<typeof callingHoursSchema>;

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(2),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const CREATABLE_TEMPLATE_IDS = listCreatableTemplates().map((t) => t.id);

export const createWorkflowRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.string().refine((v) => CREATABLE_TEMPLATE_IDS.includes(v), {
    message: 'Unknown or not-yet-available template.',
  }),
  /** Required for the custom template: the job described in the owner's words. */
  goal: z.string().trim().max(1000).nullable().default(null),
  defaultLocale: z.string().trim().min(2).max(20).default('en'),
  callingHours: callingHoursSchema.partial().nullable().default(null),
  retry: retryPolicySchema.partial().nullable().default(null),
});
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;

export const updateWorkflowRequestSchema = createWorkflowRequestSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;

export const workflowDtoSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  template: z.string(),
  templateLabel: z.string(),
  direction: z.enum(WORKFLOW_DIRECTIONS),
  enabled: z.boolean(),
  goal: z.string().nullable(),
  defaultLocale: z.string(),
  callingHours: callingHoursSchema,
  retry: retryPolicySchema,
  createdAt: z.string(),
});
export type WorkflowDto = z.infer<typeof workflowDtoSchema>;

export const createBusinessContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(30),
  email: z.string().trim().email().max(200).nullable().default(null),
  externalReference: z.string().trim().max(120).nullable().default(null),
  locale: z.string().trim().min(2).max(20).nullable().default(null),
  metadata: z.record(z.string(), z.string().max(300)).nullable().default(null),
});
export type CreateContactRequest = z.infer<typeof createBusinessContactRequestSchema>;

export const updateBusinessContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(3).max(30).optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  doNotCall: z.boolean().optional(),
  metadata: z.record(z.string(), z.string().max(300)).nullable().optional(),
});

export const businessContactDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  phoneE164: z.string(),
  email: z.string().nullable(),
  externalReference: z.string().nullable(),
  locale: z.string().nullable(),
  doNotCall: z.boolean(),
  optedOutAt: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
  createdAt: z.string(),
});
export type BusinessContactDto = z.infer<typeof businessContactDtoSchema>;

/**
 * Starts a run. `scheduledAt` null means now. Context entries are shared by
 * every recipient in the run (an appointment time, a service name) and are
 * treated as untrusted data everywhere they surface.
 */
export const createRunRequestSchema = z.object({
  contactIds: z.array(z.string().min(1).max(80)).min(1).max(50),
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  context: z.record(z.string(), z.string().max(300)).nullable().default(null),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/* -------------------------------------------------- importing contacts */

/**
 * A customer list uploaded as a spreadsheet.
 *
 * The file arrives base64 encoded in JSON rather than as multipart: it saves a
 * plugin and a second code path, and a contact list that would not fit here is
 * one that should be split anyway.
 *
 * Deliberately scoped to ONE business. These are a business's customers, not
 * the user's own address book -- the two are separate tables, separate
 * screens, and separate consent. Nothing imported here is ever visible under
 * Contacts.
 */
export const importBusinessContactsRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  /** The file itself. ~5 MB decoded, which is far more than a contact list. */
  contentBase64: z.string().min(1).max(7_000_000),
  /**
   * Read the file and report what it contains without writing anything.
   * The preview is what makes this safe to try on a real customer list.
   */
  dryRun: z.boolean().default(false),
});
export type ImportBusinessContactsRequest = z.infer<typeof importBusinessContactsRequestSchema>;

/** Why one row could not be imported, in the words shown next to it. */
export const importRowIssueSchema = z.object({
  /** 1-based, counting the header, so it matches what the spreadsheet shows. */
  row: z.number().int().positive(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  reason: z.string(),
});
export type ImportRowIssue = z.infer<typeof importRowIssueSchema>;

export const importBusinessContactsResponseSchema = z.object({
  /** Which spreadsheet column each field was read from, so a mismatch is visible. */
  columns: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    reference: z.string().nullable(),
  }),
  /** Rows with a usable name and number. Written unless this was a dry run. */
  imported: z.number().int().nonnegative(),
  /** Already on the list, matched by number. Left exactly as they were. */
  duplicates: z.number().int().nonnegative(),
  /** Everything that could not be used, and why. */
  skipped: z.array(importRowIssueSchema),
  /** Total data rows the file contained, header excluded. */
  totalRows: z.number().int().nonnegative(),
  /** True when nothing was written. */
  dryRun: z.boolean(),
  /** The first few contacts as they would be saved, for the preview. */
  sample: z.array(z.object({ name: z.string(), phoneE164: z.string() })).default([]),
});
export type ImportBusinessContactsResponse = z.infer<typeof importBusinessContactsResponseSchema>;

/**
 * Which column holds what.
 *
 * Matched on the header text people actually use, in the order most likely to
 * be right: an exact match beats a partial one, so a sheet with both "Name"
 * and "Company Name" picks the plain one.
 */
const COLUMN_ALIASES = {
  name: ['name', 'full name', 'customer', 'customer name', 'contact', 'contact name', 'client'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'tel', 'number', 'cell'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  reference: ['reference', 'ref', 'id', 'customer id', 'account', 'account number'],
} as const;

export type ImportColumnMap = { [K in keyof typeof COLUMN_ALIASES]: number | null };

export function mapImportColumns(headers: string[]): ImportColumnMap {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const pick = (aliases: readonly string[]): number | null => {
    const exact = normalized.findIndex((h) => aliases.includes(h));
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((h) => h && aliases.some((a) => h.includes(a)));
    return partial >= 0 ? partial : null;
  };
  return {
    name: pick(COLUMN_ALIASES.name),
    phone: pick(COLUMN_ALIASES.phone),
    email: pick(COLUMN_ALIASES.email),
    reference: pick(COLUMN_ALIASES.reference),
  };
}

export const RUN_STATES = [
  'queued',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'canceled',
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const RECIPIENT_STATES = [
  'pending',
  'calling',
  'completed',
  'failed',
  'skipped',
  'canceled',
] as const;
export type RecipientState = (typeof RECIPIENT_STATES)[number];

export const runRecipientDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  contactId: z.string().nullable(),
  recipientName: z.string(),
  phoneMasked: z.string(),
  locale: z.string().nullable(),
  state: z.enum(RECIPIENT_STATES),
  scheduledAt: z.string(),
  attemptCount: z.number().int(),
  outcome: z.string().nullable(),
  outcomeLabel: z.string().nullable(),
  structuredResult: z.record(z.string(), z.unknown()).nullable(),
  summary: z.string().nullable(),
  evidence: z.array(z.string()),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  transcript: z
    .array(
      z.object({
        offsetSeconds: z.number(),
        speaker: z.enum(['bot', 'user', 'unknown']),
        text: z.string(),
      }),
    )
    .default([]),
  simulated: z.boolean().default(false),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type RunRecipientDto = z.infer<typeof runRecipientDtoSchema>;

export const businessRunDtoSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  workflowId: z.string(),
  workflowName: z.string().nullable(),
  workflowTemplate: z.string().nullable(),
  state: z.enum(RUN_STATES),
  scheduledAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  stats: z.record(z.string(), z.number()),
  failureCode: z.string().nullable(),
  recipients: z.array(runRecipientDtoSchema).default([]),
});
export type BusinessRunDto = z.infer<typeof businessRunDtoSchema>;

export const businessRunSummaryDtoSchema = businessRunDtoSchema.omit({ recipients: true });
export type BusinessRunSummaryDto = z.infer<typeof businessRunSummaryDtoSchema>;

export const dashboardResponseSchema = z.object({
  callsToday: z.number().int(),
  scheduled: z.number().int(),
  completedToday: z.number().int(),
  needsAttention: z.number().int(),
  outcomeTally: z.record(z.string(), z.number()),
  upcoming: z.array(
    z.object({
      recipientId: z.string(),
      recipientName: z.string(),
      workflowName: z.string().nullable(),
      scheduledAt: z.string(),
    }),
  ),
  recent: z.array(
    z.object({
      recipientId: z.string(),
      recipientName: z.string(),
      workflowName: z.string().nullable(),
      completedAt: z.string().nullable(),
      line: z.string(),
      outcomeLabel: z.string().nullable(),
    }),
  ),
});
export type BusinessDashboard = z.infer<typeof dashboardResponseSchema>;

export const businessListEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  industryLabel: z.string(),
  status: z.enum(BUSINESS_STATUSES),
  activeWorkflows: z.number().int(),
  callsToday: z.number().int(),
});
export type BusinessListEntry = z.infer<typeof businessListEntrySchema>;
