import { eq, and, desc, sql, lt, inArray, isNull, isNotNull } from 'drizzle-orm';
import {
  tasks,
  taskEvents,
  businessCandidates,
  calls,
  callAttempts,
  authorizationRequests,
  userSettings,
  users,
  notifications,
  usageCounters,
  auditEvents,
  contacts,
  enqueueJob,
  type Db,
} from '@dial/database';
import {
  TASK_STATE_LABELS,
  isWorkingTaskState,
  dialTaskSchema,
  userPolicySchema,
  DEFAULT_USER_POLICY,
  type TaskState,
  type BusinessCandidate,
  type RankedCandidate,
  type CallRecord,
  type CallDisposition,
  type UserPolicy,
  type TaskDetail,
  type TaskMission,
  type TaskSummary,
  type UserSettings,
} from '@dial/schemas';
import { maskPhone } from '@dial/domain';
import { config } from '@dial/config';
import type { OrchestratorContext } from './context.js';

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ state */

/**
 * Moves a task to a new state and records a user-facing line for it.
 * Every state change goes through here so the timeline can never drift from
 * the task's actual state -- the progress the user sees is the real state
 * machine, not a decorative animation.
 */
export async function setState(
  ctx: OrchestratorContext,
  taskId: string,
  state: TaskState,
  message?: string,
  extra: Partial<typeof tasks.$inferInsert> = {},
): Promise<void> {
  const line = message ?? TASK_STATE_LABELS[state];
  const at = new Date().toISOString();

  /*
   * The task clock, moved in the same statement as the state.
   *
   * Reading the row first and writing back a computed total would race two
   * concurrent transitions into losing one of them. Postgres does the
   * arithmetic instead, from the row's own values:
   *
   *   entering work   -> start the clock, unless it is already running
   *   leaving work    -> bank what has elapsed and stop it
   *   staying in work -> leave it alone, so it keeps running across
   *                      researching -> calling -> comparing
   *
   * Coming back to work after finishing therefore resumes from the banked
   * total rather than from zero.
   */
  const working = isWorkingTaskState(state);

  await ctx.db
    .update(tasks)
    .set({
      state,
      updatedAt: at,
      activeMs: working
        ? sql`${tasks.activeMs}`
        : sql`${tasks.activeMs} + COALESCE(
            FLOOR(EXTRACT(EPOCH FROM (now() - ${tasks.activeSince})) * 1000)::int, 0)`,
      // A paused task keeps its state and keeps moving through the pipeline
      // for work already in flight, so the clock has to stay stopped even when
      // the state changes underneath it.
      activeSince: working
        ? sql`CASE WHEN ${tasks.pausedAt} IS NULL THEN COALESCE(${tasks.activeSince}, now()) ELSE NULL END`
        : sql`NULL`,
      ...extra,
    })
    .where(eq(tasks.id, taskId));

  await ctx.db.insert(taskEvents).values({
    id: newId('evt'),
    taskId,
    state,
    message: line,
  });

  ctx.publish(taskId, { type: 'state', taskId, state, message: line, at });
}

/**
 * Stops Dial starting anything new on a task, and stops its clock.
 *
 * What this cannot do is pull back a call already in flight: CALL-E exposes no
 * cancellation. Anything ringing keeps ringing, and its result is still
 * recorded when it lands -- the alternative is throwing away an answer the
 * user has already paid for. What pausing stops is the *next* call.
 *
 * Returns false when there was nothing to pause, so a caller can tell the
 * difference between "done" and "already was".
 */
export async function pauseTask(ctx: OrchestratorContext, taskId: string): Promise<boolean> {
  const updated = await ctx.db
    .update(tasks)
    .set({
      pausedAt: sql`now()`,
      // Bank whatever the current period has run to, then stop the clock.
      activeMs: sql`${tasks.activeMs} + COALESCE(
        FLOOR(EXTRACT(EPOCH FROM (now() - ${tasks.activeSince})) * 1000)::int, 0)`,
      activeSince: sql`NULL`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(tasks.id, taskId), isNull(tasks.pausedAt)))
    .returning({ id: tasks.id, state: tasks.state });

  if (!updated.length) return false;
  await addEvent(ctx, taskId, updated[0]!.state as TaskState, 'Paused');
  return true;
}

/**
 * Starts the task again from where it stopped.
 *
 * The clock only restarts if the task was mid-work when it was paused; a task
 * paused while waiting on the user resumes into that same wait, and waiting is
 * not work.
 */
export async function resumeTask(ctx: OrchestratorContext, taskId: string): Promise<boolean> {
  const updated = await ctx.db
    .update(tasks)
    .set({
      pausedAt: sql`NULL`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(tasks.id, taskId), isNotNull(tasks.pausedAt)))
    .returning({ id: tasks.id, state: tasks.state });

  if (!updated.length) return false;

  const state = updated[0]!.state as TaskState;
  if (isWorkingTaskState(state)) {
    await ctx.db
      .update(tasks)
      .set({ activeSince: sql`now()` })
      .where(and(eq(tasks.id, taskId), isNull(tasks.activeSince)));
  }

  await addEvent(ctx, taskId, state, 'Resumed');
  return true;
}

/** True while the user has this task paused. */
export async function isTaskPaused(db: Db, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ pausedAt: tasks.pausedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return Boolean(rows[0]?.pausedAt);
}

export async function addEvent(
  ctx: OrchestratorContext,
  taskId: string,
  state: TaskState,
  message: string,
): Promise<void> {
  // Repeating the same line is noise, not progress. A retry loop would
  // otherwise stack "Still working..." three times and make a stalled task look
  // like a busy one.
  const [latest] = await ctx.db
    .select({ message: taskEvents.message })
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.createdAt))
    .limit(1);
  if (latest?.message === message) return;

  await ctx.db.insert(taskEvents).values({ id: newId('evt'), taskId, state, message });
  ctx.publish(taskId, { type: 'event', taskId, state, message, at: new Date().toISOString() });
}

export async function getTask(db: Db, taskId: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return rows[0] ?? null;
}

export async function getTaskForUser(db: Db, taskId: string, userId: string) {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------- candidates */

export async function saveCandidates(
  db: Db,
  taskId: string,
  ranked: RankedCandidate[],
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  // The unique (task_id, phone_e164) index makes a re-run of discovery
  // idempotent for numbered businesses -- but Postgres treats NULLs as distinct,
  // so candidates without a number matched nothing and a retried research pass
  // duplicated every one of them. They are deduped here on name instead.
  const existing = await db
    .select({ id: businessCandidates.id, name: businessCandidates.name, phoneE164: businessCandidates.phoneE164 })
    .from(businessCandidates)
    .where(eq(businessCandidates.taskId, taskId));
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of existing) {
    if (row.phoneE164) byPhone.set(row.phoneE164, row.id);
    byName.set(row.name.toLowerCase(), row.id);
  }

  for (const entry of ranked) {
    const c = entry.candidate;
    const knownId = c.phoneE164 ? byPhone.get(c.phoneE164) : byName.get(c.name.toLowerCase());
    if (knownId) {
      idMap.set(c.id, knownId);
      continue;
    }
    // The same index still guards the concurrent-insert case.
    const id = newId('cand');
    const inserted = await db
      .insert(businessCandidates)
      .values({
        id,
        taskId,
        name: c.name,
        category: c.category,
        address: c.address,
        latitude: c.latitude,
        longitude: c.longitude,
        phoneE164: c.phoneE164,
        phoneRaw: c.phoneRaw,
        website: c.website,
        source: c.source,
        sourceUrl: c.sourceUrl,
        rating: c.rating,
        reviewCount: c.reviewCount,
        distanceMeters: c.distanceMeters,
        openingHours: c.openingHours,
        phoneVerified: c.phoneVerified,
        score: entry.score,
        rankReasons: entry.reasons,
        excludedReason: entry.excludedReason,
      })
      .onConflictDoNothing()
      .returning({ id: businessCandidates.id });

    if (inserted[0]?.id) {
      if (c.phoneE164) byPhone.set(c.phoneE164, inserted[0].id);
      byName.set(c.name.toLowerCase(), inserted[0].id);
      idMap.set(c.id, inserted[0].id);
    } else {
      // Lost an insert race with another worker; hand back the winner's row
      // rather than an id that does not exist.
      const [winner] = await db
        .select({ id: businessCandidates.id })
        .from(businessCandidates)
        .where(
          and(
            eq(businessCandidates.taskId, taskId),
            c.phoneE164
              ? eq(businessCandidates.phoneE164, c.phoneE164)
              : eq(businessCandidates.name, c.name),
          ),
        )
        .limit(1);
      if (winner) idMap.set(c.id, winner.id);
    }
  }
  return idMap;
}

export async function listCandidates(db: Db, taskId: string): Promise<RankedCandidate[]> {
  const rows = await db
    .select()
    .from(businessCandidates)
    .where(eq(businessCandidates.taskId, taskId))
    .orderBy(desc(businessCandidates.score));

  return rows.map((row) => ({
    candidate: rowToCandidate(row),
    score: row.score,
    reasons: (row.rankReasons as string[]) ?? [],
    excludedReason: row.excludedReason,
  }));
}

export function rowToCandidate(row: typeof businessCandidates.$inferSelect): BusinessCandidate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    phoneE164: row.phoneE164,
    phoneRaw: row.phoneRaw,
    website: row.website,
    source: row.source as BusinessCandidate['source'],
    sourceUrl: row.sourceUrl,
    rating: row.rating,
    reviewCount: row.reviewCount,
    distanceMeters: row.distanceMeters,
    openingHours: row.openingHours as BusinessCandidate['openingHours'],
    phoneVerified: row.phoneVerified,
    verificationSources: [],
  };
}

export async function markSelected(db: Db, candidateIds: string[]): Promise<void> {
  for (const id of candidateIds) {
    await db
      .update(businessCandidates)
      .set({ selectedForCall: true })
      .where(eq(businessCandidates.id, id));
  }
}

/* ------------------------------------------------------------------ calls */

export async function listCalls(db: Db, taskId: string): Promise<CallRecord[]> {
  const rows = await db.select().from(calls).where(eq(calls.taskId, taskId));
  const out: CallRecord[] = [];
  for (const row of rows) {
    const attempts = await db
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.callId, row.id));
    out.push({
      id: row.id,
      taskId: row.taskId,
      candidateId: row.candidateId,
      businessName: row.businessName,
      // The raw number never leaves the server.
      phoneMasked: maskPhone(row.phoneE164),
      providerCallId: row.providerCallId,
      simulated: row.provider === 'fake',
      providerStatus: row.providerStatus as CallRecord['providerStatus'],
      disposition: row.disposition as CallDisposition,
      structuredResult: row.structuredResult as Record<string, unknown> | null,
      summary: row.summary,
      completionConfidence: row.completionConfidence as CallRecord['completionConfidence'],
      evidence: (row.evidence as string[]) ?? [],
      transcript: attempts.flatMap(
        (a) => (a.transcript as CallRecord['transcript']) ?? [],
      ),
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    });
  }
  return out;
}

export async function findCallByProviderId(db: Db, providerCallId: string) {
  const rows = await db
    .select()
    .from(calls)
    .where(eq(calls.providerCallId, providerCallId))
    .limit(1);
  return rows[0] ?? null;
}

/* --------------------------------------------------------------- settings */

export async function getUserPolicy(db: Db, userId: string): Promise<UserPolicy> {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const raw = rows[0]?.policy;
  if (!raw) return DEFAULT_USER_POLICY;
  const parsed = userPolicySchema.safeParse(raw);
  // A malformed stored policy falls back to the *restrictive* default rather
  // than to permissiveness.
  return parsed.success ? parsed.data : DEFAULT_USER_POLICY;
}

export async function getSettings(db: Db, userId: string): Promise<UserSettings> {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const row = rows[0];
  const policy = row?.policy ? userPolicySchema.safeParse(row.policy) : null;

  return {
    policy: policy?.success ? policy.data : DEFAULT_USER_POLICY,
    defaultLocation:
      row?.defaultLatitude != null && row?.defaultLongitude != null
        ? {
            latitude: row.defaultLatitude,
            longitude: row.defaultLongitude,
            label: row.defaultLocationLabel,
          }
        : null,
    preferredLanguage: row?.preferredLanguage ?? 'en',
    callingLanguage: row?.callingLanguage ?? 'en',
    transcriptRetentionDays: row?.transcriptRetentionDays ?? 90,
    notificationsEnabled: row?.notificationsEnabled ?? true,
    askClarifyingQuestions: row?.askClarifyingQuestions ?? true,
  };
}

export async function ensureSettings(db: Db, userId: string): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, policy: DEFAULT_USER_POLICY })
    .onConflictDoNothing();
}

/* --------------------------------------------------------------- limits */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Section 27. Increments and checks the daily call ceiling in one statement so
 * two workers cannot both read "24" and both proceed.
 */
export async function reserveCallBudget(
  db: Db,
  userId: string,
  count: number,
  dailyLimit: number,
): Promise<{ granted: number }> {
  const day = today();
  await db
    .insert(usageCounters)
    .values({ userId, day, callsPlaced: 0 })
    .onConflictDoNothing();

  // The grant is computed inside the statement, from the row's prior value, so
  // two workers cannot both read the same remaining budget and both spend it.
  // Returning `new - old` is the only way to know what was actually granted
  // once the addition has been clamped to the ceiling.
  const result = await db.execute<{ granted: number }>(sql`
    WITH prev AS (
      SELECT calls_placed FROM usage_counters
      WHERE user_id = ${userId} AND day = ${day}
      FOR UPDATE
    )
    UPDATE usage_counters u
    SET calls_placed = LEAST(${dailyLimit}, u.calls_placed + ${count})
    FROM prev
    WHERE u.user_id = ${userId} AND u.day = ${day}
    RETURNING (u.calls_placed - prev.calls_placed) AS granted
  `);

  return { granted: Math.max(0, Number(result.rows?.[0]?.granted ?? 0)) };
}

/**
 * Returns budget to the user's daily counter for calls that were planned but
 * never dialled. Reserved slots that go unused must not spend the ceiling --
 * the limit exists to bound real phones rung, and a number Dial skipped rang
 * nobody.
 */
export async function releaseCallBudget(
  db: Db,
  userId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const day = today();
  await db
    .insert(usageCounters)
    .values({ userId, day, callsPlaced: 0 })
    .onConflictDoNothing();
  await db.execute(sql`
    UPDATE usage_counters
    SET calls_placed = GREATEST(0, calls_placed - ${count})
    WHERE user_id = ${userId} AND day = ${day}
  `);
}

/* ---------------------------------------------------------- suggestions */

/**
 * What this user actually asks Dial to do, so the home screen can offer it
 * again instead of the same four hardcoded examples forever.
 *
 * Deliberately narrow about what counts:
 *
 *  - Only tasks that produced a verified result. "Do this again" after a task
 *    where nobody answered is a reminder that Dial failed you, not an offer.
 *  - Only `sensitivity: 'normal'`. The interpreter classifies medical,
 *    financial, legal and high-risk requests precisely because they matter,
 *    and a prescription reminder sitting on the home screen is visible to
 *    whoever is looking at that laptop. Repetition is not worth that.
 *  - One row per domain, carrying the most recent instruction for it, because
 *    five variations of "plumber" are one suggestion, not five.
 *
 * No model call: this is a GROUP BY over rows the pipeline already wrote.
 */
export interface TaskSuggestion {
  /** The free-form business domain, e.g. 'phone_repair'. */
  domain: string;
  /** The most recent instruction for this domain, ready to run again. */
  instruction: string;
  /** How many times this user has completed a task in this domain. */
  timesUsed: number;
  /** When the most recent one finished. */
  lastUsedAt: string;
  /** Where it was, when a place was resolved. */
  locationLabel: string | null;
}

export async function getTaskSuggestions(
  db: Db,
  userId: string,
  limit: number,
): Promise<TaskSuggestion[]> {
  /*
   * `DISTINCT ON (domain)` with the ORDER BY below takes the most recent row
   * per domain, and the outer query then ranks those domains by how often the
   * user has been back. Done in one statement so a busy account does not pull
   * its whole history into memory to be grouped.
   */
  const rows = await db.execute<{
    domain: string;
    instruction: string;
    times_used: string | number;
    last_used_at: string;
    location_label: string | null;
  }>(sql`
    WITH done AS (
      SELECT
        interpreted ->> 'domain'      AS domain,
        instruction,
        location_label,
        updated_at
      FROM tasks
      WHERE user_id = ${userId}
        AND state = 'completed'
        AND interpreted IS NOT NULL
        AND result IS NOT NULL
        -- A task with no verified best option has nothing worth repeating.
        AND result -> 'best' IS NOT NULL
        AND result -> 'best' <> 'null'::jsonb
        -- Anything the interpreter flagged as sensitive stays off the home screen.
        AND COALESCE(interpreted ->> 'sensitivity', 'normal') = 'normal'
        AND COALESCE(interpreted ->> 'domain', '') <> ''
    ),
    latest AS (
      SELECT DISTINCT ON (domain)
        domain, instruction, location_label, updated_at,
        COUNT(*) OVER (PARTITION BY domain) AS times_used
      FROM done
      ORDER BY domain, updated_at DESC
    )
    SELECT
      domain,
      instruction,
      times_used,
      updated_at AS last_used_at,
      location_label
    FROM latest
    ORDER BY times_used DESC, updated_at DESC
    LIMIT ${limit}
  `);

  return (rows.rows ?? []).map((row) => ({
    domain: row.domain,
    instruction: row.instruction,
    timesUsed: Number(row.times_used) || 1,
    lastUsedAt: row.last_used_at,
    locationLabel: row.location_label,
  }));
}

/**
 * The user's own usage, for the Usage page.
 *
 * Read straight from `usage_counters`, the same rows the call budget is
 * enforced against -- so what the page shows is what actually limited the
 * work, not a second tally that could drift from it. Days with no activity
 * have no row; they are filled in as zeroes rather than omitted, so a chart
 * of the last fortnight has a bar for every day.
 */
export async function getUsage(
  db: Db,
  userId: string,
  days: number,
): Promise<{
  today: { day: string; callsPlaced: number; tasksCreated: number };
  history: Array<{ day: string; callsPlaced: number; tasksCreated: number }>;
  totals: { callsPlaced: number; tasksCreated: number };
}> {
  const wanted: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    wanted.push(d.toISOString().slice(0, 10));
  }

  const rows = await db
    .select()
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), inArray(usageCounters.day, wanted)));

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const history = wanted.map((day) => ({
    day,
    callsPlaced: byDay.get(day)?.callsPlaced ?? 0,
    tasksCreated: byDay.get(day)?.tasksCreated ?? 0,
  }));

  const todayKey = today();
  return {
    today: history.find((h) => h.day === todayKey) ?? {
      day: todayKey,
      callsPlaced: 0,
      tasksCreated: 0,
    },
    history,
    totals: {
      callsPlaced: history.reduce((sum, h) => sum + h.callsPlaced, 0),
      tasksCreated: history.reduce((sum, h) => sum + h.tasksCreated, 0),
    },
  };
}

/**
 * Records that a task was started today.
 *
 * `usage_counters.tasks_created` existed from the first migration and nothing
 * ever wrote to it, so it read zero for every user forever -- fine while
 * nothing displayed it, not fine now that the Usage page does. Counted here,
 * next to the row the call budget already uses, so both figures come from one
 * place.
 */
export async function recordTaskCreated(db: Db, userId: string): Promise<void> {
  const day = today();
  await db
    .insert(usageCounters)
    .values({ userId, day, tasksCreated: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.day],
      set: { tasksCreated: sql`${usageCounters.tasksCreated} + 1` },
    });
}

export async function countTasksToday(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.day, today())))
    .limit(1);
  return rows[0]?.tasksCreated ?? 0;
}

/* -------------------------------------------------------------- notifying */

/**
 * Records a notification and schedules its push delivery.
 *
 * The row is the durable record; the job is how it reaches a phone. Delivery
 * rides the same queue as everything else, so an offline push service retries
 * with backoff instead of losing the message, and `push.deliver` is
 * idempotent on the notification's `deliveredAt`.
 */
export async function notify(
  ctx: OrchestratorContext,
  userId: string,
  taskId: string | null,
  title: string,
  body: string,
): Promise<void> {
  const id = newId('ntf');
  await ctx.db.insert(notifications).values({ id, userId, taskId, title, body });
  await enqueueJob(ctx.db, 'push.deliver', { notificationId: id }, {
    dedupeKey: `push:${id}`,
    maxAttempts: 5,
  });
}

export async function audit(
  db: Db,
  userId: string | null,
  taskId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({ id: newId('aud'), userId, taskId, action, detail });
}

/* ---------------------------------------------------------------- mapping */

/**
 * The business domain out of the interpreted task, when there is one.
 *
 * Read defensively: `interpreted` is jsonb written by an earlier version of
 * the interpreter as often as the current one, and a task that failed before
 * interpretation has none at all.
 */
function readDomain(interpreted: unknown): string | null {
  if (!interpreted || typeof interpreted !== 'object') return null;
  const domain = (interpreted as { domain?: unknown }).domain;
  return typeof domain === 'string' && domain.trim() ? domain.trim() : null;
}

export function toTaskSummary(
  row: typeof tasks.$inferSelect,
  /**
   * Calls actually dispatched for this task. Passed in rather than counted
   * here: a list of twenty tasks would otherwise be twenty extra queries, and
   * the caller can fetch them all at once.
   */
  callCount = 0,
): TaskSummary {
  return {
    id: row.id,
    instruction: row.instruction,
    state: row.state as TaskState,
    stateLabel: TASK_STATE_LABELS[row.state as TaskState] ?? row.state,
    headline: row.headline,
    domain: readDomain(row.interpreted),
    callCount,
    activeMs: row.activeMs,
    activeSince: row.activeSince,
    pausedAt: row.pausedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}


/**
 * What Dial is aiming for on this task, and how far along it is.
 *
 * The numbers here are read back from the same rows `maybeAdvance` decides on,
 * and the target is worked out the same way it is there -- a request that names
 * its own number ("ring five places") wins over the configured default. If the
 * two ever disagreed, the panel would narrate a goal the engine was not
 * actually pursuing, which is worse than showing nothing.
 */
function buildMission(
  row: typeof tasks.$inferSelect,
  callRecords: TaskDetail['calls'],
  candidates: TaskDetail['candidates'],
): TaskMission {
  const limits = config().limits;
  const interpreted = dialTaskSchema.safeParse(row.interpreted);
  const evidenceTarget =
    (interpreted.success ? interpreted.data.constraints.candidateLimit : null) ??
    limits.comparableTarget;

  const answered = callRecords.filter((c) => c.disposition === 'answered_useful');
  // Dialled, not planned. A row without a provider call id is a business Dial
  // intends to ring, and counting it would claim a call that never happened.
  const callsPlaced = callRecords.filter((c) => c.providerCallId).length;

  /*
   * The same filter `selectCallTargets` and `tryAnotherBusiness` both apply.
   * Kept in step with them deliberately: this number is the one that actually
   * decides how far a task gets, so if it drifted from theirs the panel would
   * explain a limit the engine was not using.
   */
  const callableFound = candidates.filter(
    (c) => !c.excludedReason && c.candidate.phoneE164,
  ).length;

  return {
    evidenceTarget,
    evidenceSoFar: answered.length,
    callsPlaced,
    callBudget: limits.maxCallsUntilResult,
    candidatesFound: candidates.length,
    callableFound,
    stopReason: describeStop({
      state: row.state,
      useful: answered.length,
      target: evidenceTarget,
      placed: callsPlaced,
      budget: limits.maxCallsUntilResult,
      callable: callableFound,
      found: candidates.length,
    }),
  };
}

/**
 * Why Dial stopped, in the words a person would use.
 *
 * "Completed" covers both "found what you asked for" and "rang everyone and
 * came up short", and those deserve different sentences. Null while the task is
 * still running, because a running task has not stopped for any reason yet.
 */
export function describeStop(input: {
  state: string;
  useful: number;
  target: number;
  placed: number;
  budget: number;
  /** Businesses Dial could actually ring: listed number, open, not excluded. */
  callable: number;
  /** Businesses discovery turned up in total. */
  found: number;
}): string | null {
  const { state, useful, target, placed, budget, callable, found } = input;

  if (!['completed', 'partially_completed', 'failed', 'canceled'].includes(state)) return null;
  if (state === 'canceled') return 'You stopped this task.';
  if (useful >= target) {
    return `Dial had ${useful} comparable ${useful === 1 ? 'answer' : 'answers'}, which was enough to compare.`;
  }
  /*
   * Nothing was dialled at all, which is a different story from a run of bad
   * calls and has to be told differently.
   *
   * This branch is here because the first version did not have it, and a task
   * that never placed a call rendered "No business Dial reached could answer
   * this one" directly above "Businesses called: 0". Dial had not reached
   * anybody, so the sentence was false -- and it blamed the businesses for a
   * failure that happened on our side, before a phone was ever picked up.
   */
  if (placed === 0) {
    return 'Dial did not get as far as calling anyone.';
  }
  if (placed >= budget) {
    return `Dial reached its limit of ${budget} calls for one task before it could compare ${target}.`;
  }
  /*
   * Out of businesses rather than out of budget, which is the case the panel
   * used to hide completely.
   *
   * A search can return twenty shops and leave two that Dial may ring: the
   * rest have no listed number, or are closed at this moment, and both are
   * filtered out before the call limits are consulted. The old wording made
   * that look like a choice -- "2 of 10 max" next to "20 found" reads as Dial
   * giving up early with eighteen to spare. It had nobody left to phone.
   */
  if (placed >= callable && found > callable) {
    const skipped = found - callable;
    return (
      `Dial called every business it could: ${callable} of the ${found} it found ` +
      `${callable === 1 ? 'was' : 'were'} reachable, and the other ${skipped} ` +
      `had no listed number or were closed at the time.`
    );
  }
  if (useful === 0) {
    return `None of the ${placed} ${placed === 1 ? 'business' : 'businesses'} Dial called could answer this one.`;
  }
  return `Dial ran out of businesses to try after ${useful} ${useful === 1 ? 'answer' : 'answers'}.`;
}

export async function toTaskDetail(db: Db, row: typeof tasks.$inferSelect): Promise<TaskDetail> {
  const [candidates, callRecords, events, pending] = await Promise.all([
    listCandidates(db, row.id),
    listCalls(db, row.id),
    db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, row.id))
      .orderBy(taskEvents.createdAt),
    db
      .select()
      .from(authorizationRequests)
      .where(
        and(eq(authorizationRequests.taskId, row.id), eq(authorizationRequests.state, 'pending')),
      )
      .limit(1),
  ]);

  const auth = pending[0];

  // Whether the number is already kept, so the UI offers to save it only when
  // there is something to save.
  const savedContact = row.directPhone
    ? (
        await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.userId, row.userId), eq(contacts.phoneE164, row.directPhone)))
          .limit(1)
      ).length > 0
    : false;

  return {
    ...toTaskSummary(row),
    interpreted: (row.interpreted as TaskDetail['interpreted']) ?? null,
    candidates,
    calls: callRecords,
    mission: buildMission(row, callRecords, candidates),
    result: (row.result as TaskDetail['result']) ?? null,
    events: events.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      state: e.state as TaskState,
      message: e.message,
      createdAt: e.createdAt,
    })),
    pendingAuthorization: auth
      ? {
          id: auth.id,
          taskId: auth.taskId,
          kind: auth.kind as never,
          prompt: auth.prompt,
          details: (auth.details as Record<string, unknown>) ?? {},
          state: auth.state as never,
          createdAt: auth.createdAt,
          decidedAt: auth.decidedAt,
        }
      : null,
    directPhone: row.directPhone ?? null,
    directPhoneSaved: savedContact,
    clarificationQuestion: row.clarificationQuestion,
    clarifyingQuestions: (row.clarifyingQuestions as TaskDetail['clarifyingQuestions']) ?? [],
    clarifyingAnswers: (row.clarifyingAnswers as Record<string, string>) ?? {},
  };
}

/** Section 39: retention. Drops transcripts past the user's chosen window. */
export async function purgeExpiredTranscripts(db: Db): Promise<number> {
  const result = await db.execute(sql`
    UPDATE call_attempts SET transcript = '[]'::jsonb
    WHERE transcript <> '[]'::jsonb
      AND call_id IN (
        SELECT c.id FROM calls c
        JOIN tasks t ON t.id = c.task_id
        JOIN user_settings s ON s.user_id = t.user_id
        WHERE s.transcript_retention_days = 0
           OR c.created_at < now() - (s.transcript_retention_days * interval '1 day')
      )
    RETURNING id
  `);
  return (result.rows ?? []).length;
}

export { tasks, calls, businessCandidates, authorizationRequests, users, eq, and, desc, lt };
