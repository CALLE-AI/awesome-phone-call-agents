import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { eq, and, desc, lt, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import { config as loadConfig, type DialConfig } from '@dial/config';
import {
  tasks,
  users,
  userSettings,
  authorizationRequests,
  calls,
  contacts,
  pushTokens,
  enqueueJob,
  queueDepth,
  type Db,
} from '@dial/database';
import {
  signUpRequestSchema,
  signInRequestSchema,
  createTaskRequestSchema,
  answerClarificationRequestSchema,
  actOnBusinessRequestSchema,
  callCandidateRequestSchema,
  createContactRequestSchema,
  renameContactRequestSchema,
  answerQuestionsRequestSchema,
  authorizationDecisionRequestSchema,
  updateSettingsRequestSchema,
  userPolicySchema,
  pushRegisterRequestSchema,
  pushUnregisterRequestSchema,
  importContactsRequestSchema,
  TASK_STATE_LABELS,
  type SessionUser,
  type TaskState,
  isTerminalTaskState,
} from '@dial/schemas';
import {
  toTaskSummary,
  toTaskDetail,
  CALL_LANGUAGE_QUESTION_ID,
  listCandidates,
  callCandidateNow,
  getTaskForUser,
  getSettings,
  ensureSettings,
  getUsage,
  getTaskSuggestions,
  recordTaskCreated,
  pauseTask,
  resumeTask,
  maybeAdvance,
  handleCalleWebhook,
  setState,
  audit,
  newId,
  recentCountryFor,
  type OrchestratorContext,
} from '@dial/orchestrator';
import {
  resolveLanguageAnswer,
  normalizePhone,
  isValidE164,
  isBlockedNumber,
} from '@dial/domain';
import { logger, metricsSnapshot, incrementCounter } from '@dial/observability';
import {
  registerUser,
  authenticate,
  createSession,
  resolveSession,
  revokeSession,
} from './auth.js';
import { RealtimeHub } from './realtime.js';
import { describeValidationIssue, describeRequestFailure } from './user-message.js';
import { registerBusinessRoutes } from './business-routes.js';

const SESSION_COOKIE = 'dial_session';

export interface BuildOptions {
  db: Db;
  config?: DialConfig;
  ctx: OrchestratorContext;
  hub: RealtimeHub;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    sessionToken?: string;
  }
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const cfg = options.config ?? loadConfig();
  const { db, ctx, hub } = options;

  const app = Fastify({
    logger: false,
    // Trust the proxy only in production, where one is actually in front.
    trustProxy: cfg.isProduction,
    bodyLimit: 1024 * 512,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // this is a JSON API; the web app sets its own
  });
  await app.register(cookie, { secret: cfg.sessionSecret });
  await app.register(cors, {
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  /* ------------------------------------------------------------- auth hook */

  // Registered before the rate limiter on purpose: onRequest hooks run in
  // registration order, and the limiter's keyGenerator reads request.user to
  // key authenticated traffic per user. Registered after, it always saw an
  // unresolved user and silently degraded to per-IP limits for everyone.
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const cookieToken = request.cookies?.[SESSION_COOKIE] ?? null;
    const token = bearer ?? cookieToken;
    if (!token) return;
    const user = await resolveSession(db, token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });

  function requireUser(request: FastifyRequest, reply: FastifyReply): SessionUser | null {
    if (!request.user) {
      void reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
      return null;
    }
    return request.user;
  }

  function fail(reply: FastifyReply, status: number, code: string, message: string) {
    return reply.code(status).send({ error: { code, message } });
  }

  /* ---------------------------------------------------------------- health */

  app.get('/health', async () => {
    const depth = await queueDepth(db).catch(() => ({ pending: -1, running: -1, failed: -1 }));
    return {
      ok: true,
      version: '1.0.0',
      callMode: cfg.callMode,
      integrations: {
        calle: cfg.calle.configured,
        llm: cfg.llm.configured,
        discovery: ctx.discovery.describe(),
        queue: cfg.redisUrl ? 'redis' : 'postgres',
        database: cfg.databaseUrl ? 'postgres' : 'pglite',
        push: cfg.push.configured,
      },
      queue: depth,
    };
  });

  app.get('/metrics', async (request, reply) => {
    // Metrics can reveal usage patterns, so they require a session like
    // anything else rather than sitting open on the network.
    if (!requireUser(request, reply)) return;
    return metricsSnapshot();
  });

  /* ------------------------------------------------------------------ auth */

  app.post('/api/auth/sign-up', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const parsed = signUpRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    }
    try {
      const user = await registerUser(db, parsed.data);
      const session = await createSession(db, user.id);
      setSessionCookie(reply, session.token, session.expiresAt, cfg);
      await audit(db, user.id, null, 'sign_up');
      return { user, token: session.token };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      // Only messages Dial wrote (the 409) are safe to show. Anything else --
      // a database error from the unique-index race, a connection failure --
      // stays on this side of the boundary.
      const message =
        status >= 500
          ? 'Dial could not create that account just now. Please try again shortly.'
          : (error as Error).message;
      return fail(
        reply,
        status,
        status === 409 ? 'email_taken' : status >= 500 ? 'internal_error' : 'invalid_request',
        message,
      );
    }
  });

  app.post('/api/auth/sign-in', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const parsed = signInRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const user = await authenticate(db, parsed.data.email, parsed.data.password);
    if (!user) {
      incrementCounter('auth.failed');
      return fail(reply, 401, 'invalid_credentials', 'That email or password is not right.');
    }
    const session = await createSession(db, user.id);
    setSessionCookie(reply, session.token, session.expiresAt, cfg);
    await ensureSettings(db, user.id);
    return { user, token: session.token };
  });

  app.post('/api/auth/sign-out', async (request, reply) => {
    if (request.sessionToken) await revokeSession(db, request.sessionToken);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { user, token: null };
  });

  /* ----------------------------------------------------------------- tasks */

  app.get('/api/tasks', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 50);
    const conditions = [eq(tasks.userId, user.id)];
    if (query.cursor) conditions.push(lt(tasks.createdAt, query.cursor));

    const rows = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);

    /*
     * Call counts for the whole page in one query.
     *
     * Counting inside the map would be one query per task -- the same N+1 that
     * makes the business list slow, and this list is the sidebar, fetched on
     * every navigation. Only dispatched calls count: a planned row that was
     * never dialled must not be reported as a call.
     */
    const counts = new Map<string, number>();
    if (page.length > 0) {
      const rows = await db
        .select({ taskId: calls.taskId, n: sql<number>`count(*)::int` })
        .from(calls)
        .where(
          and(
            inArray(calls.taskId, page.map((task) => task.id)),
            isNotNull(calls.providerCallId),
          ),
        )
        .groupBy(calls.taskId);
      for (const row of rows) counts.set(row.taskId, Number(row.n));
    }

    return {
      tasks: page.map((task) => toTaskSummary(task, counts.get(task.id) ?? 0)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.createdAt ?? null) : null,
    };
  });

  app.post('/api/tasks', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    // Ask whether an interpreter actually exists, not whether a key happens to
    // be set — the context owns that decision, and refusing here means a task
    // is never created that the pipeline could not possibly progress.
    if (!ctx.interpreter) {
      return fail(
        reply,
        503,
        'llm_not_configured',
        // The code stays exact for the log; the sentence is for the person who
        // just wanted a plumber and does not run this server.
        'Dial’s AI service is not available right now. Please try again in a few minutes.',
      );
    }

    // Resolve a typed location before the task is created, so the first thing
    // the user sees already reflects where Dial will search.
    let latitude = body.location?.latitude ?? null;
    let longitude = body.location?.longitude ?? null;
    let locationLabel: string | null = null;

    if (latitude === null && body.location?.text) {
      const geo = await ctx.discovery.geocode(body.location.text).catch(() => null);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        locationLabel = geo.label;
      }
    }

    const id = newId('task');
    const inserted = await db
      .insert(tasks)
      .values({
        id,
        userId: user.id,
        instruction: body.instruction,
        state: 'created',
        latitude,
        longitude,
        locationLabel,
        idempotencyKey: body.idempotencyKey,
      })
      // A double-tap or a retried request returns the original task.
      .onConflictDoNothing()
      .returning({ id: tasks.id });

    if (inserted.length === 0) {
      const existing = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, user.id), eq(tasks.idempotencyKey, body.idempotencyKey)))
        .limit(1);
      const row = existing[0];
      if (row) return toTaskSummary(row);
      return fail(reply, 409, 'conflict', 'That task could not be created.');
    }

    // After the conflict check: a redelivered request returns the original
    // task above and must not count a second time.
    await recordTaskCreated(db, user.id);

    hub.registerTaskOwner(id, user.id);
    // Interpretation depends on a shared model service that can stay busy for
    // minutes at a time, so it gets a longer retry budget than the default.
    await enqueueJob(db, 'task.interpret', { taskId: id }, { dedupeKey: `interpret:${id}`, maxAttempts: 8 });
    await audit(db, user.id, id, 'task_created');
    incrementCounter('task.created');

    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return toTaskSummary(rows[0]!);
  });

  app.get('/api/tasks/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    hub.registerTaskOwner(id, user.id);
    return toTaskDetail(db, row);
  });

  app.post('/api/tasks/:id/clarify', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = answerClarificationRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    if (row.state !== 'needs_user_input') {
      return fail(reply, 409, 'not_awaiting_input', 'That task is not waiting on an answer.');
    }

    // The answer is appended to the instruction and the task re-interpreted,
    // so a clarification cannot smuggle in a different task.
    await db
      .update(tasks)
      .set({
        instruction: `${row.instruction}\n\nAdditional detail from the user: ${parsed.data.answer}`,
        state: 'created',
        clarificationQuestion: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id));

    // Stable dedupe key: a double-submit or a retry collapses into the job
    // that is already queued rather than running two interpretations at once.
    await enqueueJob(db, 'task.interpret', { taskId: id }, { dedupeKey: `interpret:${id}` });
    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return toTaskDetail(db, rows[0]!);
  });

  /**
   * Answers to the intake questions. Any subset is accepted, and the user can
   * skip entirely -- the questions exist to improve the outcome, not to gate it.
   */
  app.post('/api/tasks/:id/answers', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = answerQuestionsRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    if (row.state !== 'needs_user_input') {
      return fail(reply, 409, 'not_awaiting_input', 'That task is not waiting on answers.');
    }

    const questions = (row.clarifyingQuestions as Array<{ id: string }>) ?? [];
    const known = new Set(questions.map((q) => q.id));
    const answers: Record<string, string> = {
      ...((row.clarifyingAnswers as Record<string, string>) ?? {}),
    };

    for (const entry of parsed.data.answers) {
      // Only answers to questions Dial actually asked. An arbitrary key would
      // otherwise become a task constraint and reach the call brief.
      if (!known.has(entry.id)) continue;
      const value = entry.answer.trim();
      if (value) answers[entry.id] = value;
    }

    /*
     * The language question is asked once the search is done, so answering it
     * must not throw that work away. Resuming at interpretation would re-run
     * the model and the whole directory search to reach a decision already
     * made; the answer only changes how the calls are spoken.
     */
    const languageAnswer = answers[CALL_LANGUAGE_QUESTION_ID];
    const chosenLanguage = languageAnswer
      ? resolveLanguageAnswer(languageAnswer, row.countryCode)
      : null;
    /*
     * Resume where the question was asked, not where the task began.
     *
     * Keyed on which question was outstanding rather than on whether it was
     * answered: skipping the language question is a decision too, and starting
     * the whole task again -- re-running the model and the entire search to
     * reach a conclusion already reached -- is not what "skip" should mean.
     */
    const askedQuestions = (row.clarifyingQuestions as Array<{ id: string }>) ?? [];
    const wasLanguageQuestion = askedQuestions.some((q) => q.id === CALL_LANGUAGE_QUESTION_ID);
    const resumeAtCalling = wasLanguageQuestion && row.discoveredCount > 0;

    await db
      .update(tasks)
      .set({
        clarifyingAnswers: answers,
        clarifyingQuestions: [],
        // Unrecognised free text leaves the saved preference in place rather
        // than having Dial open a call in a language nobody asked for.
        ...(chosenLanguage ? { callLanguage: chosenLanguage } : {}),
        state: resumeAtCalling ? 'candidates_ready' : 'created',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id));

    await audit(db, user.id, id, parsed.data.skipped ? 'intake_skipped' : 'intake_answered', {
      answered: Object.keys(answers).length,
    });

    if (resumeAtCalling) {
      // Stable key: a retried plan job and this enqueue must collapse, or two
      // plan runs would both reserve the daily call budget for the same calls.
      await enqueueJob(db, 'task.plan_calls', { taskId: id }, { dedupeKey: `plan:${id}` });
    } else {
      // Stable dedupe key: a double-submit or a retry collapses into the job
      // that is already queued rather than running two interpretations at once.
      await enqueueJob(db, 'task.interpret', { taskId: id }, { dedupeKey: `interpret:${id}` });
    }

    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return toTaskDetail(db, rows[0]!);
  });

  /**
   * Calls a business the user chose from the list Dial found.
   *
   * Dial rings the ones it ranked highest, and a ranking can be wrong -- the
   * user sees the whole list and may know something it does not.
   */
  /**
   * Rings a business back to do something: make the appointment, place the
   * order, whatever the user asks for.
   *
   * Starts a new task rather than extending this one. The original was a
   * question and this is a commitment, so it is interpreted from scratch --
   * its side effect, sensitivity and authorization requirement all worked out
   * afresh, and gated by the user's policy exactly as the same request typed
   * into the box would be.
   */
  app.post('/api/tasks/:id/act-on-business', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = actOnBusinessRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    if (!ctx.interpreter) {
      return fail(
        reply,
        503,
        'llm_not_configured',
        // The code stays exact for the log; the sentence is for the person who
        // just wanted a plumber and does not run this server.
        'Dial’s AI service is not available right now. Please try again in a few minutes.',
      );
    }

    const ranked = await listCandidates(db, id);
    const chosen = ranked.find((r) => r.candidate.id === parsed.data.candidateId);
    if (!chosen) return fail(reply, 404, 'not_found', 'That business is not part of this task.');

    const phone = chosen.candidate.phoneE164;
    if (!phone) {
      return fail(
        reply,
        409,
        'no_phone',
        `Dial has no number it can dial for ${chosen.candidate.name}.`,
      );
    }

    const followUpId = newId('task');
    await db.insert(tasks).values({
      id: followUpId,
      userId: user.id,
      instruction: parsed.data.instruction,
      state: 'created',
      // The business is already known, so this rings it rather than searching.
      directPhone: phone,
      latitude: row.latitude,
      longitude: row.longitude,
      locationLabel: row.locationLabel,
      countryCode: row.countryCode,
      callLanguage: row.callLanguage,
      idempotencyKey: `act-${id}-${parsed.data.candidateId}-${Date.now()}`,
    });
    await recordTaskCreated(db, user.id);

    hub.registerTaskOwner(followUpId, user.id);
    await enqueueJob(db, 'task.interpret', { taskId: followUpId }, {
      dedupeKey: `interpret:${followUpId}`,
      maxAttempts: 8,
    });
    await audit(db, user.id, followUpId, 'act_on_business', {
      fromTaskId: id,
      candidateId: parsed.data.candidateId,
    });
    incrementCounter('task.act_on_business');

    const rows = await db.select().from(tasks).where(eq(tasks.id, followUpId)).limit(1);
    return toTaskSummary(rows[0]!);
  });

  app.post('/api/tasks/:id/call-candidate', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = callCandidateRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');

    const result = await callCandidateNow(ctx, id, parsed.data.candidateId);
    if (!result.ok) {
      const status =
        result.refusal === 'task_not_found' || result.refusal === 'candidate_not_found'
          ? 404
          : result.refusal === 'budget_exhausted'
            ? 429
            : result.refusal === 'not_authorized'
              ? 403
              : 409;
      return fail(reply, status, result.refusal, result.reason);
    }

    await audit(db, user.id, id, 'call_requested_by_user', {
      candidateId: parsed.data.candidateId,
    });

    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return toTaskDetail(db, rows[0]!);
  });

  app.post('/api/tasks/:id/authorization', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = authorizationDecisionRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');

    const pending = await db
      .select()
      .from(authorizationRequests)
      .where(and(eq(authorizationRequests.taskId, id), eq(authorizationRequests.state, 'pending')))
      .limit(1);
    const auth = pending[0];
    if (!auth) return fail(reply, 409, 'no_pending_authorization', 'Nothing is waiting for approval.');

    if (new Date(auth.expiresAt) < new Date()) {
      await db
        .update(authorizationRequests)
        .set({ state: 'expired', decidedAt: new Date().toISOString() })
        .where(eq(authorizationRequests.id, auth.id));
      return fail(reply, 409, 'expired', 'That approval request has expired. Start the task again.');
    }

    await db
      .update(authorizationRequests)
      .set({
        state: parsed.data.approved ? 'approved' : 'denied',
        decidedAt: new Date().toISOString(),
      })
      .where(eq(authorizationRequests.id, auth.id));

    await audit(db, user.id, id, parsed.data.approved ? 'authorization_approved' : 'authorization_denied', {
      kind: auth.kind,
    });

    if (parsed.data.approved) {
      await setState(ctx, id, 'planning_calls', 'Approved — Dial is getting started');
      // Stable key, for the same reason as the answers endpoint: two plan
      // runs must not both spend the daily budget.
      await enqueueJob(db, 'task.plan_calls', { taskId: id }, { dedupeKey: `plan:${id}` });
    } else {
      await setState(ctx, id, 'canceled', 'You declined, so Dial stopped without calling anyone.', {
        completedAt: new Date().toISOString(),
      });
    }

    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return toTaskDetail(db, rows[0]!);
  });

  /*
   * Pause and resume.
   *
   * Pausing stops Dial starting anything new and stops the task clock. It
   * cannot pull back a call already in flight -- CALL-E exposes no
   * cancellation -- so anything ringing keeps ringing and its result is still
   * recorded when it lands. The UI wording says so rather than implying
   * otherwise.
   */
  app.post('/api/tasks/:id/pause', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');

    if (isTerminalTaskState(row.state as TaskState)) {
      return fail(reply, 409, 'already_finished', 'That task has already finished.');
    }
    if (row.pausedAt) {
      return fail(reply, 409, 'already_paused', 'That task is already paused.');
    }

    await pauseTask(ctx, id);
    await audit(db, user.id, id, 'task_paused', {});
    return toTaskSummary((await getTaskForUser(db, id, user.id))!);
  });

  app.post('/api/tasks/:id/resume', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    if (!row.pausedAt) return fail(reply, 409, 'not_paused', 'That task is not paused.');

    await resumeTask(ctx, id);
    await audit(db, user.id, id, 'task_resumed', {});

    /*
     * Only nudge the pipeline where a wave may be sitting undispatched.
     *
     * maybeAdvance decides what to do next from the calls that exist. On a
     * task that has not researched yet there are none, so it concludes the
     * work is finished and moves the task to comparison -- finishing it
     * without ever ringing anybody. The earlier stages re-check on their own
     * every half minute and need no nudge.
     */
    if (row.state === 'calling' || row.state === 'collecting_results') {
      await maybeAdvance(ctx, id);
    }

    return toTaskSummary((await getTaskForUser(db, id, user.id))!);
  });

  app.post('/api/tasks/:id/cancel', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');

    const terminal = ['completed', 'partially_completed', 'failed', 'canceled'];
    if (terminal.includes(row.state)) {
      return fail(reply, 409, 'already_finished', 'That task has already finished.');
    }

    // Honest about the limit: CALL-E exposes no cancellation for a call that is
    // already in flight, so cancelling stops everything that has not yet been
    // dialled rather than pretending to pull back a live call.
    const inFlight = await db
      .select()
      .from(calls)
      .where(and(eq(calls.taskId, id), eq(calls.disposition, 'pending')));
    const dialled = inFlight.filter((c) => c.providerCallId).length;

    // Numbers planned but never dialled are released here, not just left for
    // the pipeline's state guards: flipping the rows means even a dispatch job
    // claimed mid-cancel finds nothing to ring. `not_needed` with an honest
    // message is the vocabulary the UI already renders.
    const notDialled = await db
      .update(calls)
      .set({
        disposition: 'not_needed',
        failureMessage: 'Canceled before Dial dialled.',
        completedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(calls.taskId, id),
          eq(calls.disposition, 'pending'),
          isNull(calls.providerCallId),
        ),
      )
      .returning({ id: calls.id });

    await setState(ctx, id, 'canceled', 'You canceled this task.', {
      completedAt: new Date().toISOString(),
    });
    await audit(db, user.id, id, 'task_canceled', { callsInFlight: dialled });

    return {
      ok: true,
      callsAlreadyInFlight: dialled,
      callsNotYetDialled: notDialled.length,
      note:
        dialled > 0
          ? `${dialled} ${dialled === 1 ? 'call was' : 'calls were'} already connecting and cannot be pulled back.`
          : null,
    };
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await getTaskForUser(db, id, user.id);
    if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
    await db.delete(tasks).where(eq(tasks.id, id));
    await audit(db, user.id, null, 'task_deleted', { taskId: id });
    return { ok: true };
  });

  /* -------------------------------------------------------------- settings */

  /* ------------------------------------------------------------- contacts */

  app.get('/api/contacts', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, user.id))
      .orderBy(contacts.name);
    return {
      contacts: rows.map((c) => ({
        id: c.id,
        name: c.name,
        phoneE164: c.phoneE164,
        createdAt: c.createdAt,
      })),
    };
  });

  /**
   * Keeps a number. Either given outright, or taken from a task -- the latter
   * so a raw number never travels to the client and back just to be stored.
   */
  app.post('/api/contacts', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = createContactRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    let phoneE164: string | null = null;
    if (body.taskId) {
      const row = await getTaskForUser(db, body.taskId, user.id);
      if (!row) return fail(reply, 404, 'not_found', 'That task does not exist.');
      phoneE164 = row.directPhone;
      if (!phoneE164) {
        return fail(reply, 409, 'no_number', 'That task did not use a number you gave.');
      }
    } else {
      const normalized = normalizePhone(body.phone ?? null, null);
      if (!normalized || !isValidE164(normalized.e164)) {
        return fail(reply, 400, 'invalid_request', 'That does not look like a phone number.');
      }
      if (isBlockedNumber(normalized.e164)) {
        return fail(reply, 400, 'blocked_number', 'Dial will not store that number.');
      }
      phoneE164 = normalized.e164;
    }

    const id = newId('contact');
    // Saving a number already kept renames it rather than duplicating it.
    const [saved] = await db
      .insert(contacts)
      .values({ id, userId: user.id, name: body.name, phoneE164 })
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.phoneE164],
        set: { name: body.name, updatedAt: new Date().toISOString() },
      })
      .returning();

    await audit(db, user.id, body.taskId ?? null, 'contact_saved', { contactId: saved?.id });
    return { id: saved!.id, name: saved!.name, phoneE164: saved!.phoneE164, createdAt: saved!.createdAt };
  });

  app.patch('/api/contacts/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const parsed = renameContactRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const [updated] = await db
      .update(contacts)
      .set({ name: parsed.data.name, updatedAt: new Date().toISOString() })
      .where(and(eq(contacts.id, id), eq(contacts.userId, user.id)))
      .returning();
    if (!updated) return fail(reply, 404, 'not_found', 'That contact does not exist.');
    return {
      id: updated.id,
      name: updated.name,
      phoneE164: updated.phoneE164,
      createdAt: updated.createdAt,
    };
  });

  app.delete('/api/contacts/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const [removed] = await db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, user.id)))
      .returning({ id: contacts.id });
    if (!removed) return fail(reply, 404, 'not_found', 'That contact does not exist.');
    return { ok: true };
  });

  /* ------------------------------------------------------------------ push */

  /** Registers a device for task notifications. One token, one owner. */
  app.post('/api/push/register', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = pushRegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    // A token identifies a device+app install. If it was previously registered
    // to another account (sign-out without app delete, device resale), the new
    // sign-in takes it over rather than both accounts racing for the phone.
    await db.delete(pushTokens).where(eq(pushTokens.token, parsed.data.token));
    await db.insert(pushTokens).values({
      id: newId('ptok'),
      userId: user.id,
      token: parsed.data.token,
      platform: parsed.data.platform,
    });
    await audit(db, user.id, null, 'push_registered', { platform: parsed.data.platform });
    return { ok: true };
  });

  app.post('/api/push/unregister', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = pushUnregisterRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    // Scoped to the caller's own rows: a token is only ever removed by its
    // owner or overwritten by a newer registration.
    await db
      .delete(pushTokens)
      .where(and(eq(pushTokens.token, parsed.data.token), eq(pushTokens.userId, user.id)));
    return { ok: true };
  });

  /* -------------------------------------------------- contact bulk import */

  /**
   * Imports numbers from a device address book. Entries arrive raw; Dial
   * normalizes each one (using the country of the user's recent searches as
   * the hint for local formats), skips what it cannot dial, and renames when
   * the number is already kept -- the same semantics as saving by hand.
   */
  app.post('/api/contacts/import', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = importContactsRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    const hintCountry = await recentCountryFor(db, user.id);
    let imported = 0;
    let renamed = 0;
    const skipped: Array<{ name: string; reason: 'invalid_number' | 'blocked_number' }> = [];

    for (const entry of parsed.data.contacts) {
      const normalized = normalizePhone(entry.phone, hintCountry);
      if (!normalized || !isValidE164(normalized.e164)) {
        skipped.push({ name: entry.name, reason: 'invalid_number' });
        continue;
      }
      if (isBlockedNumber(normalized.e164)) {
        skipped.push({ name: entry.name, reason: 'blocked_number' });
        continue;
      }

      // Known number -> the import renames it, exactly as saving it twice by
      // hand would. Unknown -> inserted; the conflict clause only guards a
      // concurrent import of the same number.
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.userId, user.id), eq(contacts.phoneE164, normalized.e164)))
        .limit(1);

      if (existing[0]) {
        await db
          .update(contacts)
          .set({ name: entry.name, updatedAt: new Date().toISOString() })
          .where(eq(contacts.id, existing[0].id));
        renamed += 1;
      } else {
        await db
          .insert(contacts)
          .values({
            id: newId('contact'),
            userId: user.id,
            name: entry.name,
            phoneE164: normalized.e164,
          })
          .onConflictDoNothing();
        imported += 1;
      }
    }

    await audit(db, user.id, null, 'contacts_imported', { imported, renamed, skipped: skipped.length });
    return { imported, renamed, skipped };
  });

  app.get('/api/settings', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureSettings(db, user.id);
    return getSettings(db, user.id);
  });

  /*
   * Usage, read from the very rows the call budget is enforced against, so
   * the page cannot report one figure while the limiter applies another.
   */
  app.get('/api/usage', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { days } = request.query as { days?: string };
    // Anything not a positive number falls back to the default rather than
    // being clamped: `Math.max(1, -5)` would quietly answer with one day,
    // which looks like data rather than like a rejected parameter.
    const asked = Number(days);
    const window = Number.isFinite(asked) && asked > 0 ? Math.min(90, Math.floor(asked)) : 14;
    const usage = await getUsage(db, user.id, window);
    return {
      ...usage,
      limits: {
        callsPerDay: ctx.config.limits.maxCallsPerUserPerDay,
        callsPerTask: ctx.config.limits.maxCallsPerTask,
      },
    };
  });

  /*
   * Suggestions built from the user's own finished tasks. Sensitive ones are
   * excluded in the query, not here, so no caller can forget to.
   */
  app.get('/api/suggestions', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { limit } = request.query as { limit?: string };
    const asked = Number(limit);
    const count = Number.isFinite(asked) && asked > 0 ? Math.min(12, Math.floor(asked)) : 4;
    return { suggestions: await getTaskSuggestions(db, user.id, count) };
  });

  app.patch('/api/settings', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = updateSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    await ensureSettings(db, user.id);
    const current = await getSettings(db, user.id);
    const body = parsed.data;

    const policy = body.policy ? userPolicySchema.parse({ ...current.policy, ...body.policy }) : current.policy;

    await db
      .update(userSettings)
      .set({
        policy,
        defaultLatitude: body.defaultLocation?.latitude ?? current.defaultLocation?.latitude ?? null,
        defaultLongitude: body.defaultLocation?.longitude ?? current.defaultLocation?.longitude ?? null,
        defaultLocationLabel: body.defaultLocation?.label ?? current.defaultLocation?.label ?? null,
        preferredLanguage: body.preferredLanguage ?? current.preferredLanguage,
        callingLanguage: body.callingLanguage ?? current.callingLanguage,
        transcriptRetentionDays: body.transcriptRetentionDays ?? current.transcriptRetentionDays,
        notificationsEnabled: body.notificationsEnabled ?? current.notificationsEnabled,
        askClarifyingQuestions:
          body.askClarifyingQuestions ?? current.askClarifyingQuestions,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userSettings.userId, user.id));

    return getSettings(db, user.id);
  });

  /** Manual location entry / browser geolocation labelling. */
  app.post('/api/location/resolve', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body as { text?: string; latitude?: number; longitude?: number };

    try {
      if (typeof body.latitude === 'number' && typeof body.longitude === 'number') {
        const result = await ctx.discovery.reverseGeocode(body.latitude, body.longitude);
        return result ?? { latitude: body.latitude, longitude: body.longitude, label: null, countryCode: null };
      }
      if (body.text) {
        const result = await ctx.discovery.geocode(body.text);
        if (!result) return fail(reply, 404, 'not_found', "Dial couldn't find that place.");
        return result;
      }
      return fail(reply, 400, 'invalid_request', 'Provide a place name or coordinates.');
    } catch {
      return fail(reply, 503, 'search_unavailable', 'The location service is unavailable right now.');
    }
  });

  /* --------------------------------------------------------------- account */

  app.delete('/api/account', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    // Cascades remove tasks, candidates, calls, transcripts and settings.
    await db.delete(users).where(eq(users.id, user.id));
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit(db, null, null, 'account_deleted', { userId: user.id });
    return { ok: true };
  });

  /* -------------------------------------------------------------- realtime */

  /**
   * Progress stream.
   *
   * It tails the `task_events` table rather than an in-memory bus, because the
   * work happens in the worker process, not this one. That also means a client
   * that reconnects (tab restored, phone unlocked) resumes from a durable
   * record instead of silently missing whatever happened while it was away —
   * and every line it receives corresponds to a real persisted state change.
   */
  app.get('/api/events', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const query = request.query as { taskId?: string; since?: string };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`: connected\n\n`);

    let since = query.since ?? new Date(Date.now() - 60_000).toISOString();
    // The cursor is a (created_at, id) pair. Timestamps alone lose events:
    // several land in the same instant, and anything past LIMIT 100 sharing a
    // timestamp with the cursor was skipped forever on every later poll.
    let lastId = '';
    let closed = false;

    const poll = async () => {
      if (closed) return;
      try {
        const rows = await db.execute<{
          id: string;
          task_id: string;
          state: string;
          message: string;
          created_at: string;
        }>(sql`
          SELECT e.id, e.task_id, e.state, e.message, e.created_at
          FROM task_events e
          JOIN tasks t ON t.id = e.task_id
          WHERE t.user_id = ${user.id}
            AND (e.created_at, e.id) > (${since}::timestamptz, ${lastId}::text)
            ${query.taskId ? sql`AND e.task_id = ${query.taskId}` : sql``}
          ORDER BY e.created_at, e.id
          LIMIT 100
        `);

        for (const row of rows.rows ?? []) {
          since = row.created_at;
          lastId = row.id;
          // The `id:` line gives EventSource a cursor of its own, matching
          // the durable-tail design.
          reply.raw.write(
            `id: ${row.id}\ndata: ${JSON.stringify({
              type: 'state',
              taskId: row.task_id,
              state: row.state,
              message: row.message,
              at: row.created_at,
            })}\n\n`,
          );
        }
      } catch (error) {
        logger.warn('event stream poll failed', { error: (error as Error).message });
      }
    };

    const interval = setInterval(() => void poll(), 1000);
    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    void poll();

    request.raw.on('close', () => {
      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
    });

    return reply;
  });

  /* -------------------------------------------------------------- webhooks */

  app.post('/api/webhooks/calle', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const outcome = await handleCalleWebhook(ctx, request.body, request.headers);

    if (outcome.status === 'rejected') {
      return reply.code(400).send({ error: { code: 'invalid_webhook', message: outcome.reason } });
    }
    // Duplicates and unknown calls are acknowledged: CALL-E treats any 2xx as
    // delivered, and re-delivery of something we already handled is not an error.
    return reply.code(200).send({ ok: true });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Dial could not find that page.' } }),
  );

  await registerBusinessRoutes(app, { db, ctx });

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as { statusCode?: number; message: string };
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      logger.error('request failed', {
        method: request.method,
        url: request.url,
        error: error.message,
      });
    }
    return reply.code(status).send({
      error: {
        code: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : 'invalid_request',
        /*
         * Never the framework's own words, at any status.
         *
         * 5xx was already handled; 4xx was not, so a malformed body answered
         * with "Body is not valid JSON but content-type is set to
         * 'application/json'". That is Fastify talking to a developer. The
         * precise text is in the log above, where it belongs.
         */
        message: describeRequestFailure(status),
      },
    });
  });

  return app;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, cfg: DialConfig) {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.isProduction,
    expires: expiresAt,
  });
}

/**
 * Kept as a thin alias so every call site reads the same as before. The
 * wording lives in user-message.ts, next to the other half of this split.
 */
function firstIssue(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return describeValidationIssue(error);
}

export { TASK_STATE_LABELS };
export type { TaskState };
