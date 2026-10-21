import { z } from 'zod';

export const TASK_FAMILIES = [
  'research_compare',
  'quote_request',
  'reservation',
  'appointment',
  'availability_check',
  'status_check',
  'general_inquiry',
  'service_booking',
  'other',
] as const;
export type TaskFamily = (typeof TASK_FAMILIES)[number];

export const SIDE_EFFECTS = [
  'information_only',
  'reservation',
  'appointment',
  'purchase',
  'commitment',
  'other',
] as const;
export type RequestedSideEffect = (typeof SIDE_EFFECTS)[number];

export const SENSITIVITIES = ['normal', 'personal', 'medical', 'financial', 'legal', 'high_risk'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const AUTHORIZATION_REQUIREMENTS = [
  'none',
  'user_confirmation',
  'explicit_credentials',
  'not_supported',
] as const;
export type AuthorizationRequirement = (typeof AUTHORIZATION_REQUIREMENTS)[number];

export const locationConstraintSchema = z.object({
  /** Free text as the user expressed it, e.g. "near me", "Dublin 2". */
  raw: z.string().max(200).nullable().default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  label: z.string().max(200).nullable().default(null),
  radiusKm: z.number().positive().max(200).nullable().default(null),
});
export type LocationConstraint = z.infer<typeof locationConstraintSchema>;

export const moneyConstraintSchema = z.object({
  /** "under 150" -> { comparator: 'max', amount: 150 } */
  comparator: z.enum(['max', 'min', 'around']).default('max'),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
});
export type MoneyConstraint = z.infer<typeof moneyConstraintSchema>;

export const timeWindowSchema = z.object({
  /** 24h local wall clock, "19:00". Deliberately not a Date: no timezone guessing. */
  earliest: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  latest: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  flexibilityMinutes: z.number().int().min(0).max(480).default(0),
});
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export const taskConstraintsSchema = z.object({
  budget: moneyConstraintSchema.nullable().default(null),
  /** ISO date (YYYY-MM-DD) or null. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  timeWindow: timeWindowSchema.nullable().default(null),
  distanceKm: z.number().positive().max(200).nullable().default(null),
  partySize: z.number().int().positive().max(50).nullable().default(null),
  preferredBrands: z.array(z.string().max(80)).max(20).default([]),
  excludedBusinesses: z.array(z.string().max(120)).max(50).default([]),
  candidateLimit: z.number().int().positive().max(10).nullable().default(null),
  /** Domain-specific extras the interpreter extracted, e.g. { device: "iPhone 13" }. */
  additional: z.record(z.string(), z.unknown()).default({}),
});
export type TaskConstraints = z.infer<typeof taskConstraintsSchema>;

export const dialTaskSchema = z.object({
  objective: z.string().min(1).max(500),
  taskFamily: z.enum(TASK_FAMILIES),
  /** Free-form business domain, e.g. "phone_repair", "plumbing". Not an enum by design. */
  domain: z.string().min(1).max(60),
  /** The search phrase to hand the discovery layer, e.g. "phone repair shop". */
  searchQuery: z.string().min(1).max(200),
  /**
   * Who to call, when the request names somebody rather than describing a kind
   * of business -- "call Malik", "ring the landlord".
   *
   * This is the difference between a search and a lookup. Handed "call Malik"
   * with no way to express it, the interpreter has to pretend Malik is a
   * business category, and the pipeline then asks which city to search for him
   * in.
   */
  calleeName: z.string().max(80).nullable().default(null),
  /**
   * What the user wants from the person they named, when they said.
   *
   * Needed only for a call to somebody Dial already has a number for. A search
   * carries its own purpose -- "the cheapest screen repair" says what the call
   * is for -- but "call Malik" says who to ring and nothing about what to say
   * when he answers.
   */
  callPurpose: z.string().max(300).nullable().default(null),
  location: locationConstraintSchema.nullable().default(null),
  constraints: taskConstraintsSchema,
  successCondition: z.string().min(1).max(400),
  requestedSideEffect: z.enum(SIDE_EFFECTS),
  sensitivity: z.enum(SENSITIVITIES),
  authorizationRequirement: z.enum(AUTHORIZATION_REQUIREMENTS),
  /** Set when the interpreter genuinely cannot proceed; drives needs_user_input. */
  clarificationNeeded: z.string().max(300).nullable().default(null),
  /** True only for requests that must go to emergency services, never through a call pipeline. */
  isEmergency: z.boolean().default(false),
  /**
   * Set when the request asks for something that does not exist, in the
   * user's own terms -- not "hard to find" but "cannot be found by ringing
   * anybody".
   *
   * Without this the interpreter had no way to say no. Asked to find dinosaur
   * meat in Dubai it produced a perfectly well-formed task, asked four
   * clarifying questions about it, discovered ninety-one butchers and began
   * telephoning them. Every step was working correctly; the premise was
   * never checked.
   *
   * A reason here stops the task before a single call, and the text is shown
   * to the user as-is, so it has to read as an explanation rather than a
   * refusal code.
   */
  impossibleReason: z.string().max(300).nullable().default(null),
});
export type DialTask = z.infer<typeof dialTaskSchema>;

export const TASK_STATES = [
  'created',
  'interpreting',
  'needs_user_input',
  'researching',
  'candidates_ready',
  'planning_calls',
  'calling',
  'collecting_results',
  'comparing',
  'awaiting_confirmation',
  'executing_action',
  'completed',
  'partially_completed',
  'failed',
  'canceled',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  'completed',
  'partially_completed',
  'failed',
  'canceled',
];

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

/**
 * The states in which Dial is doing the work itself.
 *
 * This is what the task timer counts. Two kinds of state are deliberately
 * outside it:
 *
 *  - `needs_user_input` and `awaiting_confirmation`, where Dial is waiting on
 *    a person. Counting those would report a task as having taken three hours
 *    because somebody answered a question after lunch.
 *  - Terminal states, obviously, and `created`/`interpreting`, which come
 *    before the work the timer is about starts.
 *
 * A task can enter and leave this set more than once: finishing, then being
 * asked to call one more business, makes it active again. The clock resumes
 * where it stopped rather than starting over, because the question it answers
 * is "how long has Dial spent on this", not "how long since the last button".
 */
export const WORKING_TASK_STATES: readonly TaskState[] = [
  'researching',
  'candidates_ready',
  'planning_calls',
  'calling',
  'collecting_results',
  'comparing',
  'executing_action',
];

export function isWorkingTaskState(state: TaskState): boolean {
  return WORKING_TASK_STATES.includes(state);
}

/**
 * How long Dial has worked on a task, in milliseconds.
 *
 * `activeMs` is what has already been banked; `activeSince` is set only while
 * the clock is running, so a client can tick without asking the server again.
 */
export function elapsedWorkingMs(
  task: { activeMs: number; activeSince: string | null },
  now: number = Date.now(),
): number {
  if (!task.activeSince) return task.activeMs;
  const started = new Date(task.activeSince).getTime();
  if (!Number.isFinite(started)) return task.activeMs;
  // A clock skew between server and client must not show negative time.
  return task.activeMs + Math.max(0, now - started);
}

/** "1:07" or "12:03" or "1:04:19" -- the shape a stopwatch has. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** User-facing wording for each state. §36: never leak machine vocabulary into the UI. */
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  created: 'Getting started',
  interpreting: 'Understanding request',
  needs_user_input: 'Needs your input',
  researching: 'Searching nearby businesses',
  candidates_ready: 'Choosing who to contact',
  planning_calls: 'Preparing calls',
  calling: 'Calling',
  collecting_results: 'Collecting answers',
  comparing: 'Comparing results',
  awaiting_confirmation: 'Needs your approval',
  executing_action: 'Completing the booking',
  completed: 'Result ready',
  partially_completed: 'Partly done',
  failed: "Couldn't complete",
  canceled: 'Canceled',
};


/* --------------------------------------------------- clarifying questions */

/**
 * A short intake question Dial asks before it starts work.
 *
 * This is deliberately different from the model interrupting mid-pipeline with
 * whatever occurs to it. These are generated once, up front, capped, and every
 * one has to earn its place by changing either who gets called or what gets
 * asked on the call. The user can always skip them.
 */
export const clarifyingQuestionSchema = z.object({
  /** Stable within the task; answers are keyed on it. */
  id: z.string().min(1).max(60),
  question: z.string().min(1).max(200),
  /** Shown as a hint, so the user can see why it is worth answering. */
  why: z.string().max(200).nullable().default(null),
  /** Suggested answers, offered as one-tap choices. */
  options: z.array(z.string().max(80)).max(6).default([]),
  /** Free text is always allowed; this only affects whether it can be left blank. */
  required: z.boolean().default(false),
});
export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;

export const clarifyingAnswerSchema = z.object({
  id: z.string().min(1).max(60),
  answer: z.string().max(500),
});
export type ClarifyingAnswer = z.infer<typeof clarifyingAnswerSchema>;
