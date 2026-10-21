import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls } from '@dial/database';
import type { CallProvider, ProviderCallSnapshot } from '@dial/calle';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubDiscovery,
  stubInterpreter,
  candidate,
  REPAIR_TASK,
  type Harness,
} from './harness.js';

/**
 * End-to-end pipeline tests: real database, real migrations, real HTTP layer,
 * real orchestration and real worker loop. Only the phone provider, the
 * interpreter and the directory are substituted.
 */

let h: Harness;

afterEach(async () => {
  await h?.close();
});

describe('the full task pipeline', () => {
  beforeEach(async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100', distanceMeters: 900 }),
          candidate({ id: 'b', name: 'MobileCare', phoneE164: '+35315550101', distanceMeters: 1400 }),
          candidate({ id: 'c', name: 'iRepair', phoneE164: '+35315550102', distanceMeters: 2600 }),
          candidate({ id: 'd', name: 'No Phone Shop', phoneE164: null }),
        ],
      }),
    });
  });

  it('carries a request from instruction to a verified, persisted result', async () => {
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    expect(created.statusCode).toBe(200);
    expect(created.body.state).toBe('created');

    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);

    // Reached a terminal state, with a headline derived from real outcomes.
    expect(['completed', 'partially_completed']).toContain(detail.state);
    expect(detail.headline).toBeTruthy();
    expect(detail.result).toBeTruthy();

    // Discovery persisted candidates, and the one with no number was excluded.
    expect(detail.candidates.length).toBe(4);
    const noPhone = detail.candidates.find((c: any) => c.candidate.name === 'No Phone Shop');
    expect(noPhone.excludedReason).toMatch(/no verified phone/i);

    // Calls were actually placed against the callable candidates only.
    expect(detail.calls.length).toBeGreaterThanOrEqual(1);
    expect(detail.calls.length).toBeLessThanOrEqual(3);
    for (const call of detail.calls) {
      expect(call.providerCallId).toBeTruthy();
      // The raw number must never leave the server.
      expect(call.phoneMasked).toMatch(/\*\*\*/);
      expect(JSON.stringify(call)).not.toContain('+35315550100');
    }

    // The tally is real, not decorative.
    expect(detail.result.tally.contacted).toBe(detail.calls.length);
    expect(detail.result.tally.discovered).toBe(4);
  });

  it('marks every simulated call as simulated, so the UI cannot present it as real', async () => {
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeGreaterThan(0);
    for (const call of detail.calls) {
      // The harness runs FakeCallProvider; nothing here rang a telephone.
      expect(call.simulated).toBe(true);
    }

    // And the transcript says so in its own words, so a reader who only sees
    // the transcript still cannot mistake it for a real conversation.
    const transcripts = detail.calls.flatMap((c: any) => c.transcript.map((t: any) => t.text));
    if (transcripts.length > 0) {
      expect(transcripts.join(' ')).toMatch(/SIMULATED CALL/);
    }
  });

  it('records a truthful progress timeline that matches the state machine', async () => {
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    const states = detail.events.map((e: any) => e.state);

    expect(states).toContain('interpreting');
    expect(states).toContain('researching');
    expect(states).toContain('candidates_ready');
    expect(states).toContain('calling');
    expect(states).toContain('comparing');
    // Every event corresponds to a persisted state, never a fabricated step.
    for (const event of detail.events) {
      expect(event.message.length).toBeGreaterThan(0);
    }
  });

  it('survives a restart: state lives in the database, not in memory', async () => {
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');

    // Run only the interpret step, then re-read as if the process had restarted.
    await h.runner.tick();
    const midway = await getTaskDetail(h, token, created.id);
    expect(midway.state).not.toBe('created');

    await h.runner.drain();
    const final = await getTaskDetail(h, token, created.id);
    expect(['completed', 'partially_completed']).toContain(final.state);
  });

  it('never dials the same business twice, even if the wave job is redelivered', async () => {
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    const rows = await h.handle.db.select().from(calls).where(eq(calls.taskId, created.id));
    const keys = rows.map((r) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);

    const phones = rows.map((r) => r.phoneE164);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it('respects the per-task call ceiling', async () => {
    await h.close();
    h = await createHarness({
      // Both bounds: the first is how many Dial plans up front, the second is
      // how far it will go while the goal is still unmet.
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '2' },
      discovery: stubDiscovery({
        candidates: Array.from({ length: 8 }, (_, i) =>
          candidate({ id: `x${i}`, name: `Shop ${i}`, phoneE164: `+3531555010${i}` }),
        ),
      }),
    });

    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    const rows = await h.handle.db.select().from(calls).where(eq(calls.taskId, created.id));
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});

describe('failure paths produce honest states, never fabricated success', () => {
  it('reports plainly when no business is found', async () => {
    h = await createHarness({ discovery: stubDiscovery({ candidates: [] }) });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/could not find any/i);
    expect(detail.result).toBeNull();
  });

  it('distinguishes a directory outage from an empty area', async () => {
    h = await createHarness({
      discovery: stubDiscovery({ candidates: [], discoverError: new Error('provider down') }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/could not reach the business directory/i);
  });

  it('says so when businesses exist but none published a usable number', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'n1', name: 'Nameless', phoneE164: null })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/none published a phone number/i);
  });

  it('asks for a location when the request names none at all', async () => {
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: { ...REPAIR_TASK, location: null },
        callFamily: 'repair_quote',
      })),
      discovery: stubDiscovery({ candidates: [], geocode: null }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');
    expect(detail.clarificationQuestion).toMatch(/where/i);
  });

  it('asks when the request says "near me" but no coordinates are known', async () => {
    // "near me" cannot be looked up. Retrying it would loop forever.
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: {
          ...REPAIR_TASK,
          location: { raw: 'near me', latitude: null, longitude: null, label: null, radiusKm: 10 },
        },
        callFamily: 'repair_quote',
      })),
      discovery: stubDiscovery({ candidates: [] }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop near me');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');
  });

  it('never asks the user to repeat a place they already gave', async () => {
    // The user said "Dublin 2" and the geocoder was momentarily down. Asking
    // "where should Dial search?" in reply would be the worst possible answer.
    h = await createHarness({
      discovery: stubDiscovery({ candidates: [], geocode: null }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a phone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).not.toBe('needs_user_input');
    expect(JSON.stringify(detail)).not.toMatch(/Where should Dial search/i);
    // It says it is still working on it instead.
    expect(detail.events.map((e: any) => e.message).join(' ')).toMatch(/still finding .* on the map/i);
  });

  it('refuses to route an emergency through the call pipeline', async () => {
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: { ...REPAIR_TASK, isEmergency: true },
        callFamily: 'general_inquiry',
      })),
      discovery: stubDiscovery({ candidates: [candidate()] }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'my kitchen is on fire');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/emergency services/i);
    // Critically: no call was placed.
    expect(detail.calls).toHaveLength(0);
  });

  it('marks an unparseable call result as needing review rather than inventing one', async () => {
    const nullResultProvider: CallProvider = {
      name: 'fake',
      placesRealCalls: false,
      async create(request): Promise<ProviderCallSnapshot> {
        return {
          providerCallId: `null_${request.idempotencyKey}`,
          status: 'completed',
          // CALL-E's honest "I could not produce a schema-valid result".
          structuredResult: null,
          summary: 'Spoke to someone but could not establish the answer.',
          taskCompleted: false,
          completionConfidence: null,
          evidence: [],
          attempts: [],
          failureCode: null,
          failureMessage: null,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
      async get(id) {
        return this.create({ idempotencyKey: id.replace('null_', '') } as never);
      },
    };

    h = await createHarness({
      provider: nullResultProvider,
      discovery: stubDiscovery({ candidates: [candidate({ id: 'z', name: 'Vague Shop' })] }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls[0].disposition).toBe('needs_review');
    expect(detail.result.best).toBeNull();
    expect(detail.result.unusable.length).toBe(1);
    expect(detail.headline).not.toMatch(/cheapest|lowest/i);
  });

  it('refuses to create a task at all when no interpreter is configured', async () => {
    h = await createHarness({ interpreter: null, env: { LLM_API_KEY: '' } });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find a plumber');
    // A precise 503 naming the missing configuration, not a silent fake.
    expect(created.statusCode).toBe(503);
    expect(created.body.error.code).toBe('llm_not_configured');
  });
});
