import { nextUsefulQuestion } from '../src/domain/decisions';
import { CONVERSATION_POLICY_VERSION } from '../src/domain/conversation';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { taskSchema, valueSchema, type CaseRecord, type Fact } from '../src/domain/model';
import { draftFromText } from '../src/domain/templates';
import {
  sampleBaseline,
  sampleCandidates,
  sampleFollowup,
  sampleResults,
} from '../src/domain/samples';
import {
  displayValue,
  evaluateCandidate,
  rankResults,
  validateTask,
} from '../src/domain/evaluator';
import {
  createGuest,
  getSession,
  hashPassword,
  makeSession,
  sha256,
  verifyPassword,
  type Auth,
  type User,
} from './auth';
import { connection, loadConfig, type Config } from './config';
import { CalleTransport, type CallTransport } from './calle';
import {
  approvePlan,
  assert,
  casePlans,
  InquiryService,
  preparePlan,
  ServiceError,
} from './inquiries';
import { Store } from './store';
import { ConnectionVerifier } from './connection';
import { checkProgress, pendingFacts } from '../src/domain/progress';
import { learnFromReview, learningSummary } from './learning';

export function createApp(
  options: { store?: Store; config?: Config; transport?: CallTransport; origin?: string } = {},
) {
  const app = express(),
    store = options.store || new Store(),
    config = options.config || loadConfig(),
    transport = options.transport || new CalleTransport(config.apiKey),
    verifier = new ConnectionVerifier(store, config, transport),
    service = new InquiryService(store, config, transport);
  const connectionInfo = (user: User) => ({
    ...connection(config, user),
    readAccess: !user.guest && config.users.includes(user.id) ? verifier.current(user.id) : null,
  });
  const origin =
    options.origin || process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production')
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    next();
  });
  app.use('/api', express.json({ limit: '80kb', strict: true }));
  const auth = (res: Response) => res.locals.auth as Auth;
  const requireCase = (req: Request, res: Response) => {
    const record = store.getCase(String(req.params.id), auth(res).user.id);
    assert(record, 404, 'Case not found.');
    return record;
  };
  const output = (record: CaseRecord, userId: string) => ({
    ...record,
    plans: casePlans(store, record.id, userId),
  });
  app.get('/api/session', (req, res) => {
    const session = getSession(store, req) || createGuest(store, res);
    res.json({
      user: session.user,
      csrf: session.csrf,
      connection: connectionInfo(session.user),
    });
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'readycheck', version: '0.1.0' }),
  );
  app.use('/api', (req, res, next) => {
    const session = getSession(store, req);
    if (!session) {
      res.status(401).json({ error: 'Your session expired. Reload to open a new workspace.' });
      return;
    }
    res.locals.auth = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== session.csrf) {
        res.status(403).json({ error: 'This write requires a valid same-origin session.' });
        return;
      }
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Use a JSON request.' });
        return;
      }
    }
    next();
  });
  const credentials = z
    .object({
      email: z
        .email()
        .max(200)
        .transform((x) => x.trim().toLowerCase()),
      password: z.string().min(12).max(200),
      name: z.string().trim().min(1).max(80).optional(),
    })
    .strict();
  app.post('/api/connection/verify', async (req, res) => {
    const user = auth(res).user;
    assert(
      !user.guest && config.users.includes(user.id),
      403,
      'Only an account authorized for controlled testing can check provider access.',
    );
    z.object({}).strict().parse(req.body);
    res.json(await verifier.verify(user.id));
  });
  app.get('/api/learning', (_req, res) => {
    res.json(learningSummary(store, auth(res).user.id));
  });
  app.delete('/api/learning/:rule', (req, res) => {
    const rule = z.enum(['explicit_usd', 'source_reference']).parse(req.params.rule);
    z.object({}).strict().parse(req.body);
    store.db
      .prepare('DELETE FROM correction_feedback WHERE owner_id=? AND rule=?')
      .run(auth(res).user.id, rule);
    res.json(learningSummary(store, auth(res).user.id));
  });
  function authRateLimit(req: Request) {
    const key = sha256(req.ip || 'unknown'),
      now = Date.now();
    const r = store.db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
    if (r && Number(r.reset_at) > now) {
      assert(Number(r.count) < 15, 429, 'Too many sign-in attempts. Try again in 15 minutes.');
      store.db.prepare('UPDATE auth_attempts SET count=count+1 WHERE key=?').run(key);
    } else
      store.db
        .prepare('INSERT OR REPLACE INTO auth_attempts VALUES(?,1,?)')
        .run(key, now + 15 * 60000);
  }
  app.post('/api/auth/signup', async (req, res) => {
    authRateLimit(req);
    const input = credentials.parse(req.body);
    assert(auth(res).user.guest, 409, 'You are already signed in.');
    assert(
      !store.db.prepare('SELECT id FROM users WHERE email=?').get(input.email),
      409,
      'An account with that email already exists. Sign in instead.',
    );
    const password = await hashPassword(input.password);
    const session = auth(res);
    store.transaction(() => {
      store.db
        .prepare('UPDATE users SET email=?,name=?,password=?,guest=0 WHERE id=? AND guest=1')
        .run(input.email, input.name || input.email.split('@')[0], password, session.user.id);
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.user.id);
    });
    const user = {
      ...session.user,
      email: input.email,
      name: input.name || input.email.split('@')[0],
      guest: false,
    };
    const next = makeSession(store, res, user);
    res.json({ user, csrf: next.csrf, connection: connectionInfo(user) });
  });
  app.post('/api/auth/signin', async (req, res) => {
    authRateLimit(req);
    const input = credentials.parse(req.body);
    const row = store.db.prepare('SELECT * FROM users WHERE email=? AND guest=0').get(input.email);
    // Perform the expensive hash on unknown accounts as well.
    const valid = await verifyPassword(
      input.password,
      (row?.password as string) || '00000000000000000000000000000000:' + '00'.repeat(64),
    );
    assert(row && valid, 401, 'Email or password is incorrect.');
    store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth(res).tokenHash);
    const user = {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      guest: false,
    };
    const next = makeSession(store, res, user);
    res.json({ user, csrf: next.csrf, connection: connectionInfo(user) });
  });
  app.post('/api/auth/signout', (_req, res) => {
    store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth(res).tokenHash);
    const next = createGuest(store, res);
    res.json({ user: next.user, csrf: next.csrf, connection: connectionInfo(next.user) });
  });
  app.post('/api/draft', (req, res) => {
    const input = z
      .object({ template: taskSchema.shape.template, text: z.string().max(2000) })
      .strict()
      .parse(req.body);
    res.json(draftFromText(input.template, input.text));
  });
  app.get('/api/cases', (_req, res) =>
    res.json(
      store.listCases(auth(res).user.id).map((c) => ({
        id: c.id,
        title: c.title,
        mode: c.mode,
        updatedAt: c.updatedAt,
        currentVersion: c.currentVersion,
        template: c.revisions.at(-1)!.task.template,
        resultCount: c.revisions.at(-1)!.results.length,
        outcome: c.outcomes.at(-1)?.state || null,
        progress: checkProgress(c, casePlans(store, c.id, auth(res).user.id)),
      })),
    ),
  );
  app.post('/api/cases', (req, res) => {
    const input = z
      .object({ task: taskSchema, mode: z.enum(['sample', 'live']) })
      .strict()
      .parse(req.body);
    if (input.mode === 'live')
      assert(
        connection(config, auth(res).user).authorized,
        403,
        'This account is not authorized for live testing.',
      );
    const now = new Date().toISOString();
    const c: CaseRecord = {
      id: randomUUID(),
      title: input.task.title,
      mode: input.mode,
      createdAt: now,
      updatedAt: now,
      currentVersion: 1,
      revisions: [{ version: 1, task: input.task, createdAt: now, results: [] }],
      outcomes: [],
      stopped: false,
    };
    store.saveCase(auth(res).user.id, c);
    res.status(201).json(output(c, auth(res).user.id));
  });
  app.get('/api/cases/:id', (req, res) =>
    res.json(output(requireCase(req, res), auth(res).user.id)),
  );
  app.patch('/api/cases/:id', (req, res) => {
    const input = z
      .object({ task: taskSchema, expectedVersion: z.number().int().positive() })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    assert(
      c.revisions[0].task.template === input.task.template,
      400,
      'The template cannot change within a case. Start a new check.',
    );
    assert(
      c.currentVersion === input.expectedVersion,
      409,
      'This case changed in another tab. Reload before saving.',
    );
    assert(
      c.revisions.length < 100,
      400,
      'This case has reached the revision limit. Start a new case.',
    );
    const now = new Date().toISOString();
    c.currentVersion++;
    c.title = input.task.title;
    c.updatedAt = now;
    c.revisions.push({
      version: c.currentVersion,
      task: input.task,
      createdAt: now,
      results: structuredClone(c.revisions.at(-1)!.results),
    });
    store.transaction(() => {
      for (const p of casePlans(store, c.id, auth(res).user.id)) service.stop(p.id);
      store.saveCase(auth(res).user.id, c);
    });
    res.json(output(c, auth(res).user.id));
  });
  app.delete('/api/cases/:id', (req, res) => {
    const c = requireCase(req, res);
    store.transaction(() => {
      for (const p of casePlans(store, c.id, auth(res).user.id)) {
        service.stop(p.id);
        store.db.prepare("UPDATE plans SET data='{}' WHERE id=?").run(p.id);
        store.db.prepare("UPDATE inquiries SET payload='{}' WHERE plan_id=?").run(p.id);
        store.db
          .prepare(
            'DELETE FROM provider_results WHERE inquiry_id IN (SELECT id FROM inquiries WHERE plan_id=?)',
          )
          .run(p.id);
      }
      store.db.prepare("UPDATE cases SET deleted=1,data='{}' WHERE id=?").run(c.id);
      store.db
        .prepare('DELETE FROM correction_feedback WHERE case_id=? AND owner_id=?')
        .run(c.id, auth(res).user.id);
    });
    res.json({ deleted: true });
  });
  app.post('/api/cases/:id/sample', (req, res) => {
    const input = z
      .object({
        expectedVersion: z.number().int().positive(),
        candidateIds: z.array(z.string()).min(1).max(3),
      })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    assert(c.mode === 'sample', 400, 'Samples cannot be loaded into a live case.');
    assert(
      c.currentVersion === input.expectedVersion,
      409,
      'The case changed. Reload before checking.',
    );
    const revision = c.revisions.at(-1)!;
    const errors = validateTask(revision.task);
    assert(!Object.keys(errors).length, 400, Object.values(errors).join(' '));
    const allowed = sampleCandidates(revision.task.template).map((x) => x.id);
    assert(
      input.candidateIds.every((x) => allowed.includes(x)) &&
        new Set(input.candidateIds).size === input.candidateIds.length,
      400,
      'Select unique sample candidates.',
    );
    const baseline = sampleBaseline(revision.task.template, c.createdAt, c.revisions[0].task);
    revision.results = [
      ...revision.results,
      ...sampleResults(baseline).filter(
        (r) =>
          input.candidateIds.includes(r.id) && !revision.results.some((old) => old.id === r.id),
      ),
    ];
    c.updatedAt = new Date().toISOString();
    store.saveCase(auth(res).user.id, c);
    res.json(output(c, auth(res).user.id));
  });
  app.post('/api/cases/:id/sample-followup', (req, res) => {
    const input = z
      .object({
        candidateId: z.string(),
        expectedVersion: z.number().int().positive(),
        focusField: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    assert(
      c.mode === 'sample' && c.currentVersion === input.expectedVersion,
      409,
      'The sample revision changed.',
    );
    const revision = c.revisions.at(-1)!;
    const index = revision.results.findIndex((r) => r.id === input.candidateId);
    assert(index >= 0, 404, 'Candidate result not found.');
    const unresolved = evaluateCandidate(revision.task, revision.results[index])
      .checks.filter((x) => x.verdict !== 'pass')
      .map((x) => x.requirement.id);
    if (input.focusField) {
      const advice = nextUsefulQuestion(revision.task, revision.results[index]);
      assert(
        advice.kind === 'ask' && advice.field === input.focusField,
        409,
        'The recommended question changed. Refresh the evidence.',
      );
    }
    revision.results[index] = sampleFollowup(
      revision.results[index],
      input.focusField ? [input.focusField] : unresolved,
    );
    c.updatedAt = new Date().toISOString();
    store.saveCase(auth(res).user.id, c);
    res.json(output(c, auth(res).user.id));
  });
  app.post('/api/cases/:id/outcomes', (req, res) => {
    const input = z
      .object({
        candidateId: z.string(),
        state: z.enum(['selected', 'arrangement_confirmed', 'completed', 'closed_without_success']),
        note: z.string().max(500).default(''),
      })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    assert(
      c.revisions.some((r) => r.results.some((x) => x.id === input.candidateId)),
      404,
      'Candidate not found.',
    );
    const prior = c.outcomes.filter((o) => o.candidateId === input.candidateId).at(-1)?.state;
    const allowed: Record<string, string[]> = {
      none: ['selected', 'closed_without_success'],
      selected: ['arrangement_confirmed', 'closed_without_success'],
      arrangement_confirmed: ['completed', 'closed_without_success'],
      completed: [],
      closed_without_success: ['selected'],
    };
    assert(
      allowed[prior || 'none'].includes(input.state),
      409,
      'Choose the next valid outcome. Selection and arrangement must be confirmed first.',
    );
    c.outcomes.push({
      ...input,
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: auth(res).user.id,
    });
    c.updatedAt = new Date().toISOString();
    store.saveCase(auth(res).user.id, c);
    res.json(output(c, auth(res).user.id));
  });
  app.post('/api/cases/:id/stop', (req, res) => {
    const c = requireCase(req, res);
    c.stopped = true;
    store.transaction(() => {
      for (const p of casePlans(store, c.id, auth(res).user.id)) service.stop(p.id);
      store.saveCase(auth(res).user.id, c);
    });
    res.json(output(c, auth(res).user.id));
  });
  app.post('/api/cases/:id/plans', (req, res) => {
    const input = z
      .object({
        recipientIds: z.array(z.string()).min(1).max(3),
        expectedVersion: z.number().int().positive(),
        followupFor: z.string().optional(),
        focusField: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    assert(c.currentVersion === input.expectedVersion, 409, 'The request changed.');
    assert(
      !Object.keys(validateTask(c.revisions.at(-1)!.task)).length,
      400,
      'Complete the required fields first.',
    );
    if (input.focusField) {
      const revision = c.revisions.at(-1)!;
      const result = revision.results.find((r) => r.id === input.followupFor);
      const advice = result ? nextUsefulQuestion(revision.task, result) : null;
      assert(
        advice?.kind === 'ask' && advice.field === input.focusField,
        409,
        'The recommended question changed. Refresh the evidence.',
      );
    }
    const prior = casePlans(store, c.id, auth(res).user.id).find(
      (p) =>
        p.policyVersion === CONVERSATION_POLICY_VERSION &&
        p.learningVersion === learningSummary(store, auth(res).user.id).version &&
        p.version === c.currentVersion &&
        p.followupFor === input.followupFor &&
        p.focusField === input.focusField &&
        p.recipients.map((r) => r.id).join() === input.recipientIds.join() &&
        ['prepared', 'approved'].includes(p.status) &&
        Date.parse(p.expiresAt) > Date.now(),
    );
    res.json(
      prior ||
        preparePlan(
          store,
          config,
          auth(res).user,
          c,
          input.recipientIds,
          input.followupFor,
          input.focusField,
        ),
    );
  });
  app.post('/api/plans/:id/approve', async (req, res) => {
    const input = z
      .object({ hash: z.string(), consent: z.literal(true) })
      .strict()
      .parse(req.body);
    approvePlan(store, config, auth(res).user, String(req.params.id), input.hash);
    res.json(await service.dispatchNext(String(req.params.id), auth(res).user));
  });
  app.post('/api/plans/:id/continue', async (req, res) =>
    res.json(await service.dispatchNext(String(req.params.id), auth(res).user)),
  );
  app.post('/api/inquiries/:id/recover', async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(await service.recover(String(req.params.id), auth(res).user));
  });
  app.post('/api/inquiries/:id/reconcile', async (req, res) => {
    const input = z
      .object({ vendorId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) })
      .strict()
      .parse(req.body);
    res.json(await service.reconcile(String(req.params.id), input.vendorId, auth(res).user));
  });
  app.post('/api/cases/:id/review', (req, res) => {
    const input = z
      .object({
        version: z.number().int().positive(),
        candidateId: z.string(),
        reviews: z
          .array(
            z
              .object({
                factId: z.string(),
                action: z.enum(['confirm', 'reject', 'correct']),
                value: valueSchema.optional(),
                reason: z.string().max(500).optional(),
                supersedes: z.string().optional(),
                certainty: z.enum(['confirmed', 'tentative']).optional(),
                conditions: z.array(z.string().min(1).max(500)).max(10).optional(),
                context: z.array(z.string().min(1).max(500)).max(10).optional(),
                priceBasis: z.enum(['all_in', 'minimum', 'estimate', 'unit']).nullable().optional(),
                answerState: z.enum(['value', 'unavailable', 'unknown']).optional(),
                turn: z.number().int().nonnegative().optional(),
                evidenceTurns: z.array(z.number().int().nonnegative()).max(20).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(40),
      })
      .strict()
      .parse(req.body);
    const c = requireCase(req, res);
    const revision = c.revisions.find((r) => r.version === input.version);
    assert(revision, 404, 'Revision not found.');
    const result = revision.results.find((r) => r.id === input.candidateId);
    assert(result, 404, 'Result not found.');
    store.transaction(() => {
      for (const review of input.reviews) {
        let correctedFact: Fact | undefined;
        const fact: Fact | undefined = result.facts.find((f) => f.id === review.factId);
        assert(fact, 404, 'Fact not found.');
        assert(
          !fact.rejected &&
            !result.facts.some(
              (newer) => newer.supersedes === fact.id && newer.reviewed && !newer.rejected,
            ),
          409,
          'This evidence was rejected or replaced. Review its current interpretation.',
        );
        assert(
          review.action === 'correct' ||
            [
              review.certainty,
              review.conditions,
              review.context,
              review.priceBasis,
              review.answerState,
              review.turn,
              review.evidenceTurns,
            ].every((v) => v === undefined),
          400,
          'Metadata changes require an audited correction with a reason.',
        );
        if (review.action === 'reject') fact.rejected = true;
        else if (review.action === 'confirm') {
          fact.reviewed = true;
          if (review.supersedes) {
            assert(
              result.facts.some(
                (f, index) =>
                  f.id === review.supersedes &&
                  f.field === fact.field &&
                  index < result.facts.indexOf(fact),
              ),
              400,
              'Correction must refer to an earlier fact for this field.',
            );
            fact.supersedes = review.supersedes;
          }
        } else {
          assert(
            review.value !== undefined && review.reason?.trim(),
            400,
            'A correction needs a value and a reason.',
          );
          const source =
            fact.sourceId === result.sourceId ? result.transcript : result.sources?.[fact.sourceId];
          const turn = review.turn ?? fact.turn;
          assert(
            source?.[turn]?.speaker === 'recipient' && source[turn].text.includes(fact.raw),
            400,
            'The source turn must contain this exact recipient quote.',
          );
          const evidenceTurns = [
            ...new Set([turn, ...(review.evidenceTurns ?? fact.evidenceTurns ?? [])]),
          ].sort((a, b) => a - b);
          assert(
            evidenceTurns.every((i) => !!source?.[i]),
            400,
            'Supporting turns must belong to this source conversation.',
          );
          const corrected: Fact = {
            ...fact,
            id: randomUUID(),
            value: review.value,
            certainty: review.certainty ?? fact.certainty,
            conditions: review.conditions ?? fact.conditions,
            context: review.context ?? fact.context,
            priceBasis:
              review.priceBasis === null ? undefined : (review.priceBasis ?? fact.priceBasis),
            answerState: review.answerState ?? fact.answerState,
            turn,
            evidenceTurns,
            scope:
              (review.answerState ?? fact.answerState) === 'unavailable'
                ? {
                    ...fact.scope,
                    [fact.field]: revision.task.requirements.find((r) => r.id === fact.field)!
                      .value,
                  }
                : fact.scope,
            reviewed: true,
            supersedes: fact.id,
            correctedBy: auth(res).user.id,
            correctionReason: review.reason,
            repairs: undefined,
            rejected: false,
          };
          result.facts.push(corrected);
          correctedFact = corrected;
        }
        learnFromReview(store, auth(res).user.id, c, result, fact, review.action, correctedFact);
        store.event(result.inquiryId || null, `fact_${review.action}`, fact.id);
      }
      const pending = pendingFacts(result).length > 0;
      if (!pending && result.inquiryId)
        store.db
          .prepare(
            "UPDATE inquiries SET state='evaluated',updated_at=? WHERE id=? AND state='review_required'",
          )
          .run(new Date().toISOString(), result.inquiryId);
      c.updatedAt = new Date().toISOString();
      store.saveCase(auth(res).user.id, c);
      if (!pending && evaluateCandidate(revision.task, result).verdict === 'pass') {
        const row = store.db
          .prepare('SELECT plan_id FROM inquiries WHERE id=?')
          .get(result.inquiryId || '');
        if (row) service.stop(String(row.plan_id));
      }
    });
    res.json(output(c, auth(res).user.id));
  });
  app.post('/api/cases/:id/acknowledge', (req, res) => {
    const input = z.object({ inquiryId: z.string() }).strict().parse(req.body);
    const c = requireCase(req, res);
    const plan = casePlans(store, c.id, auth(res).user.id).find((p) =>
      p.inquiries.some((i) => i.id === input.inquiryId),
    );
    assert(plan, 404, 'Inquiry not found.');
    const result = c.revisions
      .find((r) => r.version === plan.version)
      ?.results.find((r) => r.inquiryId === input.inquiryId);
    assert(result && pendingFacts(result).length === 0, 409, 'Review all extracted facts first.');
    store.db
      .prepare("UPDATE inquiries SET state='evaluated' WHERE id=? AND state='review_required'")
      .run(input.inquiryId);
    res.json(output(c, auth(res).user.id));
  });
  app.get('/api/cases/:id/export', (req, res) => {
    const c = requireCase(req, res);
    const requested = Number(req.query.version || c.currentVersion),
      revision = c.revisions.find((r) => r.version === requested);
    assert(revision, 404, 'Revision not found.');
    const lines = [
      `ReadyCheck — ${revision.task.title}`,
      `Revision ${revision.version} · ${c.mode.toUpperCase()}${c.mode === 'sample' ? ' — ALL PROVIDERS AND RESPONSES ARE FICTIONAL' : ''}`,
      `Locality: ${revision.task.locality} · Time zone: ${revision.task.timeZone}`,
      '',
      ...revision.task.requirements.map(
        (r) => `${r.label} (${r.importance}): ${displayValue(r, revision.task.timeZone)}`,
      ),
      '',
    ];
    for (const { candidate, evaluation } of rankResults(revision.task, revision.results)) {
      lines.push(
        `${candidate.name}: ${evaluation.label}`,
        `Checked: ${candidate.checkedAt}; ${candidate.disposition}`,
      );
      for (const check of evaluation.checks) {
        lines.push(`  ${check.requirement.label}: ${check.verdict} — ${check.reason}`);
        for (const f of check.facts)
          lines.push(`    Evidence: “${f.raw}” (${f.sourceId}, turn ${f.turn}, ${f.observedAt})`);
      }
      lines.push('');
    }
    lines.push(
      'Human-recorded outcomes:',
      ...c.outcomes.map(
        (o) => `${o.at}: ${o.candidateId} — ${o.state}${o.note ? ' — ' + o.note : ''}`,
      ),
      '',
      'An inquiry is not a reservation, transaction, or guarantee.',
    );
    res
      .type('text/plain')
      .attachment(`readycheck-${c.id}-v${revision.version}.txt`)
      .send(lines.join('\n'));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request.' });
      return;
    }
    console.error('Request failed', {
      eventId: randomUUID(),
      type: err instanceof Error ? err.name : 'unknown',
    });
    res
      .status(500)
      .json({ error: 'The operation could not be completed. Your saved data is still available.' });
  });
  return { app, store, service };
}
