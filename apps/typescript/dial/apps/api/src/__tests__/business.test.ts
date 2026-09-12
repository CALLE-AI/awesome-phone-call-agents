import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  businessRunRecipients,
  businessRuns,
  jobs,
  processedWebhookEvents,
} from '@dial/database';
import type { CallProvider, ProviderCallSnapshot } from '@dial/calle';
import { ProviderError } from '@dial/calle';
import {
  createHarness,
  signUp,
  type Harness,
} from './harness.js';

/**
 * The business mode, end to end, on the same real PGlite + real Fastify +
 * real worker harness as the consumer pipeline: create a business, pick a
 * template, add a customer, schedule or run, and watch the durable worker
 * dispatch through the provider exactly once and record a structured,
 * human-readable result.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/* --------------------------------------------------------- test provider */

function scriptedProvider(options: {
  snapshot?: Partial<ProviderCallSnapshot>;
  failFirstCreateWith?: ProviderError;
}): { provider: CallProvider; createdKeys: string[] } {
  const createdKeys: string[] = [];
  let failed = false;
  const provider: CallProvider = {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      if (options.failFirstCreateWith && !failed) {
        failed = true;
        throw options.failFirstCreateWith;
      }
      createdKeys.push(request.idempotencyKey);
      const providerCallId = `pc_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`;
      const inProgress = options.snapshot?.status === 'in_progress';
      return {
        providerCallId,
        status: 'completed',
        structuredResult: null,
        summary: null,
        taskCompleted: null,
        completionConfidence: null,
        evidence: [],
        attempts: [],
        failureCode: null,
        failureMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ...options.snapshot,
        ...(inProgress ? { completedAt: null } : {}),
        attempts:
          options.snapshot?.attempts ??
          (inProgress
            ? []
            : [
                {
                  id: `${providerCallId}_a1`,
                  phoneMasked: '+35***00',
                  status: 'completed',
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  summary: options.snapshot?.summary ?? 'Answered.',
                  transcript: [
                    { offsetSeconds: 0, speaker: 'bot' as const, text: 'Hello.' },
                    { offsetSeconds: 3, speaker: 'user' as const, text: 'Yes, confirmed.' },
                  ],
                  failureCode: null,
                  failureMessage: null,
                },
              ]),
      };
    },
    async get(requestedId: string) {
      // The authenticated re-fetch: the terminal truth for this call.
      return {
        providerCallId: requestedId,
        status: 'completed',
        structuredResult: null,
        summary: null,
        taskCompleted: null,
        completionConfidence: null,
        evidence: [],
        attempts: [],
        failureCode: null,
        failureMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ...(options.snapshot?.status === 'in_progress' ? options.snapshot : {}),
        status: 'completed',
        structuredResult:
          options.snapshot?.structuredResult ?? {
            outcome: 'confirmed',
            confidence: 'high',
            evidence_summary: 'Confirmed on the call.',
          },
        summary: options.snapshot?.summary ?? 'Confirmed.',
        completedAt: new Date().toISOString(),
        attempts: [
          {
            id: `${requestedId}_a1`,
            phoneMasked: '+35***00',
            status: 'completed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            summary: options.snapshot?.summary ?? 'Confirmed.',
            transcript: [],
            failureCode: null,
            failureMessage: null,
          },
        ],
      };
    },
  };
  return { provider, createdKeys };
}

/* ------------------------------------------------------------ setup util */

async function setupBusiness(provider: CallProvider, env: Record<string, string> = {}) {
  h = await createHarness({ provider, env });
  const { token } = await signUp(h);
  const business = await h.app.inject({
    method: 'POST',
    url: '/api/businesses',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Acme Dental',
      industry: 'healthcare',
      timezone: 'UTC',
      country: 'IE',
      locale: 'en',
    },
  });
  expect(business.statusCode).toBe(200);
  const businessId = (business.json() as { id: string }).id;

  const workflow = await h.app.inject({
    method: 'POST',
    url: `/api/businesses/${businessId}/workflows`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Appointment reminders',
      template: 'appointment_reminder',
      callingHours: { startHour: 0, endHour: 24 },
    },
  });
  expect(workflow.statusCode).toBe(200);
  const workflowId = (workflow.json() as { id: string }).id;

  const contact = await h.app.inject({
    method: 'POST',
    url: `/api/businesses/${businessId}/contacts`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Sarah Doe', phone: '087 123 4567' },
  });
  expect(contact.statusCode).toBe(200);
  const contactId = (contact.json() as { id: string }).id;

  return { token, businessId, workflowId, contactId };
}

async function createRun(token: string, businessId: string, workflowId: string, contactIds: string[]) {
  return h.app.inject({
    method: 'POST',
    url: `/api/businesses/${businessId}/workflows/${workflowId}/runs`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      contactIds,
      context: { appointmentAt: '2026-08-25 10:30 AM' },
    },
  });
}

async function recipientRows(runId: string) {
  return h.handle.db.select().from(businessRunRecipients).where(eq(businessRunRecipients.runId, runId));
}

/* ----------------------------------------------------------------- tests */

describe('business access control', () => {
  it('creates a business and hides it from everyone else', async () => {
    const { provider } = scriptedProvider({});
    h = await createHarness({ provider });
    const alice = await signUp(h);
    const bob = await signUp(h);

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { name: 'Acme Dental', industry: 'healthcare' },
    });
    expect(created.statusCode).toBe(200);
    const businessId = (created.json() as { id: string }).id;

    const asBob = await h.app.inject({
      method: 'GET',
      url: `/api/businesses/${businessId}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(asBob.statusCode).toBe(404);

    const bobList = await h.app.inject({
      method: 'GET',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect((bobList.json() as { businesses: unknown[] }).businesses).toHaveLength(0);

    const anonymous = await h.app.inject({ method: 'GET', url: '/api/businesses' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('rejects an unknown template and requires a goal for custom jobs', async () => {
    const { provider } = scriptedProvider({});
    const { token, businessId } = await setupBusiness(provider);

    const badTemplate = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Made up', template: 'not_a_template' },
    });
    expect(badTemplate.statusCode).toBe(400);

    // 'front_desk' was a real template id that could never run, because
    // CALL-E cannot receive calls. It is gone rather than greyed out, and a
    // stored workflow referring to it must not spring back to life.
    const frontDesk = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Front desk', template: 'front_desk' },
    });
    expect(frontDesk.statusCode).toBe(400);

    const noGoal = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Custom', template: 'general_followup' },
    });
    expect(noGoal.statusCode).toBe(400);
  });
});

describe('describing the business', () => {
  /**
   * "Other" used to be the end of the conversation: the list did not fit, and
   * nothing recorded what the business actually was.
   */
  it('keeps what the owner typed for "Other" and shows it back as the label', async () => {
    const { provider } = scriptedProvider({});
    h = await createHarness({ provider });
    const owner = await signUp(h);

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Rise & Grind', industry: 'other', customIndustry: 'Bakery' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { id: string; customIndustry: string; industryLabel: string };
    expect(body.customIndustry).toBe('Bakery');
    // Not "Other" -- the label a person reads is the one they wrote.
    expect(body.industryLabel).toBe('Bakery');

    const listed = await h.app.inject({
      method: 'GET',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const entry = (listed.json() as { businesses: Array<{ industryLabel: string }> }).businesses[0];
    expect(entry!.industryLabel).toBe('Bakery');
  });

  it('drops the free text when the industry moves to a named one', async () => {
    const { provider } = scriptedProvider({});
    h = await createHarness({ provider });
    const owner = await signUp(h);

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Rise & Grind', industry: 'other', customIndustry: 'Bakery' },
    });
    const businessId = (created.json() as { id: string }).id;

    // Otherwise "Bakery" would still be sitting on a business now marked
    // Retail, and every screen would show the stale word.
    const moved = await h.app.inject({
      method: 'PATCH',
      url: `/api/businesses/${businessId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { industry: 'retail' },
    });
    expect(moved.statusCode).toBe(200);
    const body = moved.json() as { customIndustry: string | null; industryLabel: string };
    expect(body.customIndustry).toBeNull();
    expect(body.industryLabel).toBe('Retail');
  });

  it('stores a country as its ISO region code, which is what parses numbers', async () => {
    const { provider } = scriptedProvider({});
    h = await createHarness({ provider });
    const owner = await signUp(h);

    // 'AE' is the region; +971 is its dialling code. The field takes the
    // former, and a local Emirati number must come back fully qualified.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Dubai Dental', industry: 'healthcare', country: 'AE', businessPhone: '055 123 4567' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { country: string; businessPhone: string };
    expect(body.country).toBe('AE');
    expect(body.businessPhone).toBe('+971551234567');
  });
});

describe('business contacts', () => {
  it('normalizes to E.164, rejects garbage and premium numbers', async () => {
    const { provider } = scriptedProvider({});
    const { token, businessId } = await setupBusiness(provider);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/businesses/${businessId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });
    const contacts = (list.json() as { contacts: Array<{ phoneE164: string }> }).contacts;
    expect(contacts[0]!.phoneE164).toBe('+353871234567');

    const invalid = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', phone: '12345' },
    });
    expect(invalid.statusCode).toBe(400);

    const blocked = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Premium', phone: '+19005550001' },
    });
    expect(blocked.statusCode).toBe(400);
  });

  it('never dials an opted-out contact', async () => {
    const { provider, createdKeys } = scriptedProvider({});
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    await h.app.inject({
      method: 'PATCH',
      url: `/api/businesses/${businessId}/contacts/${contactId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { doNotCall: true },
    });

    const run = await createRun(token, businessId, workflowId, [contactId]);
    expect(run.statusCode).toBe(200);
    const runId = (run.json() as { run: { id: string } }).run.id;

    await h.runner.drain();
    expect(createdKeys).toHaveLength(0);

    const rows = await recipientRows(runId);
    expect(rows[0]!.state).toBe('skipped');
    expect(rows[0]!.failureCode).toBe('opted_out');
  });
});

describe('the appointment a run is told about', () => {
  /**
   * The form collects a date and a time through two controls, and the value
   * behind them can legitimately hold a half-filled answer while one is
   * still empty. The submit button is disabled until both are in -- these
   * pin the second line of defence, for anything that gets past it.
   */
  async function runWith(
    token: string,
    businessId: string,
    workflowId: string,
    contactIds: string[],
    appointmentAt: string | undefined,
  ) {
    return h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactIds,
        context: appointmentAt === undefined ? {} : { appointmentAt },
      },
    });
  }

  it('refuses a date with no time, and a time with no date', async () => {
    const { provider } = scriptedProvider({});
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const dateOnly = await runWith(token, businessId, workflowId, [contactId], '2026-08-25T');
    expect(dateOnly.statusCode).toBe(400);

    const timeOnly = await runWith(token, businessId, workflowId, [contactId], 'T10:30');
    expect(timeOnly.statusCode).toBe(400);

    const missing = await runWith(token, businessId, workflowId, [contactId], undefined);
    expect(missing.statusCode).toBe(400);
  });

  it('accepts the complete value the two controls compose', async () => {
    const { provider } = scriptedProvider({});
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const ok = await runWith(token, businessId, workflowId, [contactId], '2026-08-25T10:30');
    expect(ok.statusCode).toBe(200);
  });
});

describe('durable business runs', () => {
  it('schedules a durable job, dispatches once, and records the structured result', async () => {
    const { provider, createdKeys } = scriptedProvider({
      snapshot: {
        structuredResult: {
          outcome: 'confirmed',
          requested_callback: false,
          confidence: 'high',
          evidence_summary: 'She confirmed the appointment.',
        },
        summary: 'Confirmed.',
      },
    });
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contactIds: [contactId], scheduledAt: when, context: { appointmentAt: '2026-08-25 10:30 AM' } },
    });
    expect(scheduled.statusCode).toBe(200);
    const runId = (scheduled.json() as { run: { id: string } }).run.id;

    // The durable job exists with the future run time and a stable dedupe key.
    const queued = await h.handle.db.select().from(jobs).where(eq(jobs.kind, 'biz.dispatch_run'));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.dedupeKey).toBe(`birun:${runId}`);

    // Pull the scheduled job forward so drain() claims it now.
    await h.handle.db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.kind, 'biz.dispatch_run'));
    await h.runner.drain();

    expect(createdKeys).toEqual([`biz:${(await recipientRows(runId))[0]!.id}:a1`]);
    const rows = await recipientRows(runId);
    expect(rows[0]!.state).toBe('completed');
    expect(rows[0]!.disposition).toBe('confirmed');
    expect((rows[0]!.structuredResult as { outcome: string }).outcome).toBe('confirmed');
    expect(rows[0]!.providerCallId).toBeTruthy();
    expect(rows[0]!.simulated).toBe(true);

    const runRow = (await h.handle.db.select().from(businessRuns).where(eq(businessRuns.id, runId)))[0]!;
    expect(runRow.state).toBe('completed');
    expect(runRow.stats).toEqual({ confirmed: 1 });

    // A retried create of the same run is refused, not duplicated.
    const duplicate = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contactIds: [contactId], scheduledAt: when, context: { appointmentAt: '2026-08-25 10:30 AM' } },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('reschedules itself outside the allowed calling hours', async () => {
    const { provider } = scriptedProvider({});
    h = await createHarness({ provider });
    const { token } = await signUp(h);
    const business = await h.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Night Clinic', timezone: 'UTC' },
    });
    const businessId = (business.json() as { id: string }).id;
    const workflow = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows`,
      headers: { authorization: `Bearer ${token}` },
      // A window that is guaranteed to exclude "now": it opens next hour.
      payload: {
        name: 'Reminder',
        template: 'appointment_reminder',
        callingHours: { startHour: (new Date().getUTCHours() + 1) % 24, endHour: (new Date().getUTCHours() + 2) % 24 || 24 },
      },
    });
    const workflowId = (workflow.json() as { id: string }).id;
    const contact = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sarah', phone: '+353871234567' },
    });
    const contactId = (contact.json() as { id: string }).id;

    const run = await createRun(token, businessId, workflowId, [contactId]);
    const runId = (run.json() as { run: { id: string } }).run.id;
    await h.runner.drain();

    // Nothing was dialled; the work moved to the next window instead.
    const rows = await recipientRows(runId);
    expect(rows[0]!.state).toBe('pending');
    const parked = await h.handle.db.select().from(jobs).where(eq(jobs.kind, 'biz.dispatch_run'));
    expect(
      parked.some((j) => j.state === 'pending' && new Date(j.runAt as unknown as string).getTime() > Date.now()),
    ).toBe(true);
  });

  it('a retryable provider failure does not create a second call', async () => {
    const { provider, createdKeys } = scriptedProvider({
      failFirstCreateWith: new ProviderError('provider_unavailable', 'busy', 503, true),
      snapshot: {
        structuredResult: {
          outcome: 'reschedule_requested',
          requested_callback: true,
          confidence: 'medium',
          evidence_summary: 'Asked the office to call back.',
        },
      },
    });
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const run = await createRun(token, businessId, workflowId, [contactId]);
    const runId = (run.json() as { run: { id: string } }).run.id;

    // First attempt fails retryably; the queue backs off, so pull the retry
    // forward and let it succeed.
    await h.runner.drain();
    await h.handle.db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(and(eq(jobs.kind, 'biz.dispatch_run'), eq(jobs.state, 'pending')));
    await h.runner.drain();

    // The queue ran the job twice, but the second attempt derived the SAME
    // deterministic idempotency key -- never a fresh one. A real provider
    // deduplicates that into exactly one phone call; a fresh key per retry
    // is what would double-dial.
    const rows = await recipientRows(runId);
    expect(createdKeys).toEqual([`biz:${rows[0]!.id}:a1`]);
    expect(rows[0]!.state).toBe('completed');
    expect(rows[0]!.disposition).toBe('reschedule_requested');
    expect(rows[0]!.attemptCount).toBe(1);
    expect(rows[0]!.providerCallId).toBeTruthy();
  });
});

describe('results and aggregation', () => {
  it('records a no-answer outcome and aggregates the dashboard', async () => {
    const { provider } = scriptedProvider({
      snapshot: {
        status: 'failed',
        failureCode: 'no_answer',
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: 'pc_a1',
            phoneMasked: '+35***00',
            status: 'failed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            summary: null,
            transcript: [],
            failureCode: 'no_answer',
            failureMessage: 'No answer',
          },
        ],
      },
    });
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const run = await createRun(token, businessId, workflowId, [contactId]);
    const runId = (run.json() as { run: { id: string } }).run.id;
    await h.runner.drain();

    const rows = await recipientRows(runId);
    expect(rows[0]!.state).toBe('completed');
    expect(rows[0]!.disposition).toBe('no_answer');

    const runRow = (await h.handle.db.select().from(businessRuns).where(eq(businessRuns.id, runId)))[0]!;
    expect(runRow.state).toBe('completed');
    expect(runRow.stats).toEqual({ no_answer: 1 });

    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/businesses/${businessId}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = dashboard.json() as {
      callsToday: number;
      completedToday: number;
      outcomeTally: Record<string, number>;
      recent: Array<{ line: string }>;
    };
    expect(body.callsToday).toBe(1);
    expect(body.completedToday).toBe(1);
    expect(body.outcomeTally).toEqual({ no_answer: 1 });
    expect(body.recent[0]!.line).toContain('No answer');
  });

  it('a duplicated webhook changes nothing the second time', async () => {
    // Dispatch leaves the call in progress; the webhook delivers the result.
    const { provider } = scriptedProvider({
      snapshot: {
        status: 'in_progress',
        structuredResult: null,
        summary: null,
        attempts: [],
        completedAt: null,
      },
    });
    /*
     * The poll job must still be *pending* when this test deletes it below.
     * With the harness default of a 1ms poll delay, `drain()` can claim and
     * run it on a slow enough machine -- the scripted `get()` then completes
     * the recipient before the webhook arrives, and the assertion fails. A
     * developer's own .env setting CALL_POLL_DELAY_MS=5000 hid this locally
     * while every fresh clone tripped on it. Pinning the delay here makes the
     * test's assumption explicit instead of environmental.
     */
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider, {
      CALL_POLL_DELAY_MS: '60000',
    });

    const run = await createRun(token, businessId, workflowId, [contactId]);
    const runId = (run.json() as { run: { id: string } }).run.id;
    await h.runner.drain();
    const rows = await recipientRows(runId);
    const providerCallId = rows[0]!.providerCallId!;

    // A poll job is now pending; make it harmless by completing the recipient
    // through the webhook path instead.
    await h.handle.db.delete(jobs).where(eq(jobs.kind, 'biz.poll_recipient'));

    // Swap the provider's answer for the terminal one the re-fetch returns.
    const terminalProvider = scriptedProvider({
      snapshot: {
        status: 'completed',
        structuredResult: {
          outcome: 'cancel_requested',
          requested_callback: false,
          confidence: 'high',
          evidence_summary: 'She wants to cancel.',
        },
        summary: 'Wants to cancel.',
      },
    });
    h.ctx.provider = terminalProvider.provider;

    const body = {
      id: 'evt_biz_1',
      type: 'call.completed',
      created_at: new Date().toISOString(),
      data: { id: providerCallId, status: 'completed' },
    };
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_biz_1' },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_biz_1' },
      payload: body,
    });
    expect(second.statusCode).toBe(200);

    const events = await h.handle.db.select().from(processedWebhookEvents);
    expect(events.filter((e) => e.eventId === 'evt_biz_1')).toHaveLength(1);

    const after = await recipientRows(runId);
    expect(after[0]!.state).toBe('completed');
    expect(after[0]!.disposition).toBe('cancel_requested');

    const runRow = (await h.handle.db.select().from(businessRuns).where(eq(businessRuns.id, runId)))[0]!;
    expect(runRow.state).toBe('completed');
  });

  it('canceling a queued run dials nobody', async () => {
    const { provider, createdKeys } = scriptedProvider({});
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);

    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const run = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contactIds: [contactId], scheduledAt: when, context: { appointmentAt: '2026-08-25 10:30 AM' } },
    });
    const runId = (run.json() as { run: { id: string } }).run.id;

    const canceled = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(canceled.statusCode).toBe(200);

    // The parked job still fires (durability), sees the cancellation, stops.
    await h.handle.db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.kind, 'biz.dispatch_run'));
    await h.runner.drain();

    expect(createdKeys).toHaveLength(0);
    const rows = await recipientRows(runId);
    expect(rows[0]!.state).toBe('canceled');
  });

  it('writes a human-readable line for an appointment confirmation', async () => {
    const { provider } = scriptedProvider({
      snapshot: {
        structuredResult: {
          outcome: 'confirmed',
          requested_callback: false,
          confidence: 'high',
          evidence_summary: 'Confirmed.',
        },
        summary: 'Confirmed.',
      },
    });
    const { token, businessId, workflowId, contactId } = await setupBusiness(provider);
    const run = await createRun(token, businessId, workflowId, [contactId]);
    const runId = (run.json() as { run: { id: string } }).run.id;
    await h.runner.drain();

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/businesses/${businessId}/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = detail.json() as { run: { recipients: Array<{ transcript: unknown[] }> } };
    // Transcripts are kept (owner retention is the default 90 days).
    expect(body.run.recipients[0]!.transcript.length).toBeGreaterThan(0);

    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/businesses/${businessId}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    const recent = (dashboard.json() as { recent: Array<{ line: string; outcomeLabel: string }> }).recent;
    expect(recent[0]!.line).toContain('Sarah');
    expect(recent[0]!.line).toContain('confirmed');
    expect(recent[0]!.outcomeLabel).toBe('Confirmed');
  });
});
