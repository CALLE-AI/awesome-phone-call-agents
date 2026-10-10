import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Section 23. One normalised model, owned by the server, shared by web and
 * mobile. There is no second database anywhere: a task created on a phone is
 * the same row the browser reads.
 */

/* -------------------------------------------------------------------- user */

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    /** scrypt, salted, stored as a single encoded string. Never logged. */
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_key').on(t.email),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the bearer token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

/** Standing authorization policy + preferences. One row per user. */
export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  policy: jsonb('policy').notNull(),
  defaultLatitude: doublePrecision('default_latitude'),
  defaultLongitude: doublePrecision('default_longitude'),
  defaultLocationLabel: text('default_location_label'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  callingLanguage: text('calling_language').notNull().default('en'),
  transcriptRetentionDays: integer('transcript_retention_days').notNull().default(90),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  askClarifyingQuestions: boolean('ask_clarifying_questions').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** Registered push tokens, so a completed task can notify the right device. */
/**
 * Numbers the user has chosen to keep, so a number typed once does not have to
 * be typed again. Renaming is the point: "+971 55 550 1234" tells you nothing
 * a month later, "Ahmed at the garage" tells you everything.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One entry per number per user: saving the same number twice is a rename,
    // not a second contact.
    uniquePhone: uniqueIndex('contacts_user_phone').on(t.userId, t.phoneE164),
    userIdx: index('contacts_user_idx').on(t.userId, t.name),
  }),
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ tokenIdx: uniqueIndex('push_tokens_token_key').on(t.token) }),
);

/* -------------------------------------------------------------------- task */

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instruction: text('instruction').notNull(),
    state: text('state').notNull().default('created'),
    /** The interpreted DialTask, once the interpreter has run. */
    interpreted: jsonb('interpreted'),
    callFamily: text('call_family'),
    /** Resolved coordinates actually used for discovery. */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    locationLabel: text('location_label'),
    /**
     * BCP-47 language for this task's calls, once the user has chosen one.
     * Null means nothing has been decided and the saved preference applies.
     */
    callLanguage: text('call_language'),
    /**
     * A number the user named in the request itself. Present means there is
     * nothing to search for -- Dial rings this and never asks where to look.
     * Server-side only, like every other raw number.
     */
    directPhone: text('direct_phone'),
    /**
     * How many times Dial has asked what the call is for. Counted so an
     * unclear answer can be met with another question without the two of them
     * going round forever.
     */
    purposeAsks: integer('purpose_asks').notNull().default(0),
    /** ISO 3166-1 alpha-2 of the area searched, so the calling step can offer
     * that country's language without geocoding again. */
    countryCode: text('country_code'),
    /** Final TaskResult once comparison has run. */
    result: jsonb('result'),
    headline: text('headline'),
    /** Question shown when state is needs_user_input. */
    clarificationQuestion: text('clarification_question'),
    /**
     * How long Dial has worked on this task, in milliseconds, banked across
     * every period of activity. A task that finishes and is then asked to call
     * one more business resumes from here rather than from zero.
     */
    activeMs: integer('active_ms').notNull().default(0),
    /** When the current period of work began; null whenever the clock is stopped. */
    activeSince: timestamp('active_since', { withTimezone: true, mode: 'string' }),
    /**
     * Set while the user has paused the task. Paused is not a state: the task
     * keeps the state it was in, so resuming continues from there rather than
     * having to reconstruct where it had got to.
     */
    pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'string' }),
    /** Intake questions Dial asks before starting. */
    clarifyingQuestions: jsonb('clarifying_questions').notNull().default([]),
    /** Answers, keyed by question id. */
    clarifyingAnswers: jsonb('clarifying_answers').notNull().default({}),
    /** True once intake has run, so answering cannot re-trigger it. */
    intakeDone: boolean('intake_done').notNull().default(false),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    discoveredCount: integer('discovered_count').notNull().default(0),
    /** Client-supplied, so a retry cannot create a second task. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => ({
    userIdx: index('tasks_user_created_idx').on(t.userId, t.createdAt),
    idemIdx: uniqueIndex('tasks_user_idempotency_key').on(t.userId, t.idempotencyKey),
    stateIdx: index('tasks_state_idx').on(t.state),
  }),
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    /** Already user-facing. Nothing here needs translating at render time. */
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ taskIdx: index('task_events_task_idx').on(t.taskId, t.createdAt) }),
);

/* --------------------------------------------------------------- discovery */

export const businessCandidates = pgTable(
  'business_candidates',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
    address: text('address'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** E.164 only, or null. Never a guess. */
    phoneE164: text('phone_e164'),
    phoneRaw: text('phone_raw'),
    website: text('website'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    rating: doublePrecision('rating'),
    reviewCount: integer('review_count'),
    distanceMeters: integer('distance_meters'),
    openingHours: jsonb('opening_hours'),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    score: doublePrecision('score').notNull().default(0),
    rankReasons: jsonb('rank_reasons').notNull().default([]),
    excludedReason: text('excluded_reason'),
    selectedForCall: boolean('selected_for_call').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('business_candidates_task_idx').on(t.taskId),
    // One row per business per task, so a re-run of discovery cannot duplicate.
    taskPhoneIdx: uniqueIndex('business_candidates_task_phone_key').on(t.taskId, t.phoneE164),
  }),
);

/** Provenance: which source gave us which field, and when. */
export const candidateSources = pgTable(
  'candidate_sources',
  {
    id: text('id').primaryKey(),
    candidateId: text('candidate_id')
      .notNull()
      .references(() => businessCandidates.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceId: text('source_id'),
    sourceUrl: text('source_url'),
    contributed: jsonb('contributed').notNull().default([]),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ candidateIdx: index('candidate_sources_candidate_idx').on(t.candidateId) }),
);

/* ------------------------------------------------------------------- calls */

export const calls = pgTable(
  'calls',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    candidateId: text('candidate_id')
      .notNull()
      .references(() => businessCandidates.id, { onDelete: 'cascade' }),
    businessName: text('business_name').notNull(),
    /** The number actually dialled. Masked before it ever leaves the server. */
    phoneE164: text('phone_e164').notNull(),
    /** Stable, derived from task+candidate+attempt. Never a fresh UUID. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** Which backend placed it: 'calle' (real) or 'fake' (simulated). */
    provider: text('provider'),
    providerCallId: text('provider_call_id'),
    /** CALL-E's own status, stored verbatim. */
    providerStatus: text('provider_status'),
    /** Dial's judgement, kept separate from the provider's status. */
    disposition: text('disposition').notNull().default('pending'),
    structuredResult: jsonb('structured_result'),
    summary: text('summary'),
    completionConfidence: jsonb('completion_confidence'),
    taskCompleted: boolean('task_completed'),
    evidence: jsonb('evidence').notNull().default([]),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    /** Which wave this call belonged to, for controlled dispatch. */
    wave: integer('wave').notNull().default(1),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** When the current attempt started being waited on. */
    waitingSince: timestamp('waiting_since', { withTimezone: true, mode: 'string' }),
    /** Set when this call was dispatched to replace one that did not answer. */
    replacedCallId: text('replaced_call_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => ({
    taskIdx: index('calls_task_idx').on(t.taskId),
    providerIdx: uniqueIndex('calls_provider_call_id_key').on(t.providerCallId),
    // The hard guarantee against a retried worker dialling twice.
    idemIdx: uniqueIndex('calls_idempotency_key').on(t.idempotencyKey),
  }),
);

/** Per-attempt detail as reported by CALL-E, including transcript turns. */
export const callAttempts = pgTable(
  'call_attempts',
  {
    id: text('id').primaryKey(),
    callId: text('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    providerAttemptId: text('provider_attempt_id'),
    status: text('status').notNull(),
    phoneMasked: text('phone_masked'),
    summary: text('summary'),
    /** Dropped entirely when the user's retention setting is 0. */
    transcript: jsonb('transcript').notNull().default([]),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    callIdx: index('call_attempts_call_idx').on(t.callId),
    providerIdx: uniqueIndex('call_attempts_provider_key').on(t.callId, t.providerAttemptId),
  }),
);

/* ----------------------------------------------------------- authorization */

export const authorizationRequests = pgTable(
  'authorization_requests',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    prompt: text('prompt').notNull(),
    details: jsonb('details').notNull().default({}),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => ({ taskIdx: index('authorization_requests_task_idx').on(t.taskId, t.state) }),
);

/* ---------------------------------------------------------------- webhooks */

/**
 * At-least-once delivery means duplicates are normal, not exceptional.
 * The primary key is the event id, so a replay is a no-op by construction.
 */
export const processedWebhookEvents = pgTable('processed_webhook_events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  providerCallId: text('provider_call_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------- audit */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    taskId: text('task_id'),
    action: text('action').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('audit_events_user_idx').on(t.userId, t.createdAt) }),
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('notifications_user_idx').on(t.userId, t.createdAt) }),
);

/** Daily per-user call counter backing the section 27 spend ceiling. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD in UTC. */
    day: text('day').notNull(),
    callsPlaced: integer('calls_placed').notNull().default(0),
    tasksCreated: integer('tasks_created').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.day] }) }),
);

/* ------------------------------------------------------------------- queue */

/**
 * The durable job queue. Postgres rather than Redis, claimed with
 * FOR UPDATE SKIP LOCKED. Rationale in docs/DECISIONS.md: it gives real
 * at-least-once durability with the database we already require, survives a
 * worker restart, and needs no second piece of infrastructure. The BullMQ
 * driver is used instead when REDIS_URL is set.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    state: text('state').notNull().default('pending'),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    /** Deduplicates enqueues; a repeated schedule is a no-op. */
    dedupeKey: text('dedupe_key'),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
    lockedBy: text('locked_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => ({
    pollIdx: index('jobs_poll_idx').on(t.state, t.runAt),
    dedupeIdx: uniqueIndex('jobs_dedupe_key').on(t.dedupeKey),
  }),
);

/* ------------------------------------------------------- business mode */

/**
 * The second orchestration mode: a business account's workflows call its own
 * customers through the same CALL-E provider and the same durable queue as
 * consumer tasks. Deliberately separate from `business_candidates` (which
 * records businesses DISCOVERED for a task) and from `calls` (whose rows are
 * task/candidate-shaped). No fake tasks are created to fit this in.
 */

export const businesses = pgTable(
  'businesses',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Advisory only -- recommends templates; never branches application code. */
    industry: text('industry').notNull().default('other'),
    /** Free text the owner typed for "Other". Advisory, like `industry`. */
    customIndustry: text('custom_industry'),
    timezone: text('timezone').notNull().default('UTC'),
    country: text('country'),
    locale: text('locale').notNull().default('en'),
    address: text('address'),
    website: text('website'),
    businessPhone: text('business_phone'),
    status: text('status').notNull().default('active'),
    hours: jsonb('hours'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ ownerIdx: index('businesses_owner_idx').on(t.ownerUserId) }),
);

export const businessMembers = pgTable(
  'business_members',
  {
    id: text('id').primaryKey(),
    businessId: text('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    memberUnique: uniqueIndex('business_members_unique').on(t.businessId, t.userId),
    userIdx: index('business_members_user_idx').on(t.userId),
  }),
);

export const businessWorkflows = pgTable(
  'business_workflows',
  {
    id: text('id').primaryKey(),
    businessId: text('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Which declarative template this runs on. Not an industry column. */
    template: text('template').notNull(),
    direction: text('direction').notNull().default('outbound'),
    enabled: boolean('enabled').notNull().default(true),
    /** The owner's extra instructions for custom jobs. Untrusted at brief time. */
    goal: text('goal'),
    defaultLocale: text('default_locale').notNull().default('en'),
    callingHours: jsonb('calling_hours').notNull().default({ startHour: 9, endHour: 19 }),
    retry: jsonb('retry').notNull().default({ maxAttempts: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({ businessIdx: index('business_workflows_business_idx').on(t.businessId) }),
);

export const businessContacts = pgTable(
  'business_contacts',
  {
    id: text('id').primaryKey(),
    businessId: text('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    externalReference: text('external_reference'),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    email: text('email'),
    locale: text('locale'),
    metadata: jsonb('metadata').notNull().default({}),
    doNotCall: boolean('do_not_call').notNull().default(false),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    contactUnique: uniqueIndex('business_contacts_business_phone').on(t.businessId, t.phoneE164),
    nameIdx: index('business_contacts_business_name_idx').on(t.businessId, t.name),
  }),
);

export const businessRuns = pgTable(
  'business_runs',
  {
    id: text('id').primaryKey(),
    businessId: text('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => businessWorkflows.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('queued'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    /** Deterministic; a retried create returns the original run. */
    idempotencyKey: text('idempotency_key').notNull(),
    context: jsonb('context').notNull().default({}),
    stats: jsonb('stats').notNull().default({}),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    idemUnique: uniqueIndex('business_runs_idempotency_key').on(t.idempotencyKey),
    stateIdx: index('business_runs_business_state_idx').on(t.businessId, t.state),
    scheduledIdx: index('business_runs_scheduled_idx').on(t.scheduledAt),
  }),
);

export const businessRunRecipients = pgTable(
  'business_run_recipients',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => businessRuns.id, { onDelete: 'cascade' }),
    /** Snapshot survives contact deletion; null when the contact row is gone. */
    contactId: text('contact_id').references(() => businessContacts.id, { onDelete: 'set null' }),
    recipientName: text('recipient_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    locale: text('locale'),
    context: jsonb('context').notNull().default({}),
    state: text('state').notNull().default('pending'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    provider: text('provider'),
    providerCallId: text('provider_call_id'),
    providerStatus: text('provider_status'),
    /** Dial's short verdict: the template outcome, or a failure mapping. */
    disposition: text('disposition'),
    structuredResult: jsonb('structured_result'),
    summary: text('summary'),
    evidence: jsonb('evidence').notNull().default([]),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    waitingSince: timestamp('waiting_since', { withTimezone: true, mode: 'string' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    simulated: boolean('simulated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('business_run_recipients_run_idx').on(t.runId),
    providerIdx: uniqueIndex('business_run_recipients_provider_call_id').on(t.providerCallId),
    stateIdx: index('business_run_recipients_state_idx').on(t.state),
  }),
);

/** Per-attempt detail for business calls, mirroring `call_attempts`. */
export const businessCallAttempts = pgTable(
  'business_call_attempts',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => businessRunRecipients.id, { onDelete: 'cascade' }),
    providerAttemptId: text('provider_attempt_id'),
    status: text('status').notNull(),
    phoneMasked: text('phone_masked'),
    summary: text('summary'),
    transcript: jsonb('transcript').notNull().default([]),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => ({
    recipientIdx: index('business_call_attempts_recipient_idx').on(t.recipientId),
    attemptUnique: uniqueIndex('business_call_attempts_provider_key').on(t.recipientId, t.providerAttemptId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type CandidateRow = typeof businessCandidates.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type AuthorizationRequestRow = typeof authorizationRequests.$inferSelect;
export type BusinessRow = typeof businesses.$inferSelect;
export type BusinessWorkflowRow = typeof businessWorkflows.$inferSelect;
export type BusinessContactRow = typeof businessContacts.$inferSelect;
export type BusinessRunRow = typeof businessRuns.$inferSelect;
export type BusinessRunRecipientRow = typeof businessRunRecipients.$inferSelect;
