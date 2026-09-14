import { describe, it, expect, afterEach } from 'vitest';
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
 * Two things a finished task should not be the end of.
 *
 * Dial found the businesses and got the answer; ringing one back to act on it
 * is the obvious next thing, and the user says what for. And a task that rang
 * five businesses without learning anything is not finished -- it has stopped,
 * which is a different thing, and there are usually ninety more in the list.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

function snapshot(over: Partial<ProviderCallSnapshot> = {}): ProviderCallSnapshot {
  return {
    providerCallId: 'c1',
    status: 'completed',
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    attempts: [],
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...over,
  };
}

/** Answers, but never with anything that can be compared. */
const answersUselessly: CallProvider = {
  name: 'fake',
  placesRealCalls: false,
  async create(request) {
    return snapshot({
      providerCallId: `u_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
      structuredResult: { can_repair: 'unknown' },
      summary: 'They could not say.',
    });
  },
  async get(id) {
    return snapshot({ providerCallId: id, structuredResult: { can_repair: 'unknown' } });
  },
};

/** The nth business finally gives a usable answer. */
function usefulOnAttempt(threshold: number): CallProvider {
  let seen = 0;
  return {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      seen += 1;
      const useful = seen >= threshold;
      return snapshot({
        providerCallId: `p_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
        structuredResult: useful
          ? { can_repair: 'yes', quoted_price: 120, currency: 'EUR' }
          : { can_repair: 'unknown' },
        summary: useful ? 'Quoted EUR 120.' : 'They could not say.',
        taskCompleted: useful,
      });
    },
    async get(id) {
      return snapshot({ providerCallId: id, structuredResult: { can_repair: 'unknown' } });
    },
  };
}

function manyBusinesses(count: number) {
  return stubDiscovery({
    candidates: Array.from({ length: count }, (_, i) =>
      candidate({
        id: `b${i}`,
        name: `Business ${i}`,
        phoneE164: `+3531679${String(3500 + i).padStart(4, '0')}`,
        distanceMeters: 100 + i * 10,
      }),
    ),
  });
}

describe('keeping going until something is usable', () => {
  it('rings past the ordinary ceiling when nothing has come back', async () => {
    // Five calls is enough when they are producing answers. When none of them
    // has, stopping at five hands the user nothing.
    h = await createHarness({
      provider: answersUselessly,
      env: { MAX_CALLS_PER_TASK: '3', MAX_CALLS_UNTIL_RESULT: '7', CALL_WAVE_SIZE: '3' },
      discovery: manyBusinesses(12),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeGreaterThan(3);
    expect(detail.calls.length).toBeLessThanOrEqual(7);
  });

  it('stops the moment something usable arrives', async () => {
    // Persistence is for getting an answer, not for exhausting the list.
    h = await createHarness({
      provider: usefulOnAttempt(4),
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '9', CALL_WAVE_SIZE: '2' },
      discovery: manyBusinesses(12),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.result?.best).toBeTruthy();
    // It kept going past the ordinary ceiling, and stopped well short of nine.
    expect(detail.calls.length).toBeGreaterThanOrEqual(4);
    expect(detail.calls.length).toBeLessThan(9);
  });

  it('says why it is still going', async () => {
    h = await createHarness({
      provider: answersUselessly,
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '5', CALL_WAVE_SIZE: '2' },
      discovery: manyBusinesses(10),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const timeline = (await getTaskDetail(h, token, created.id)).events
      .map((e: any) => e.message)
      .join(' ');
    expect(timeline).toMatch(/Not enough to compare yet — trying/i);
  });

  it('gives up rather than working through every business', async () => {
    // The higher ceiling is where Dial gives up, not an invitation to ring
    // ninety businesses.
    h = await createHarness({
      provider: answersUselessly,
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '5', CALL_WAVE_SIZE: '2' },
      discovery: manyBusinesses(40),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeLessThanOrEqual(5);
    expect(['completed', 'partially_completed', 'failed']).toContain(detail.state);
  });

  it('still respects the daily budget', async () => {
    // Persistence is bounded by Dial's own ceiling; the daily limit is about
    // real money and binds regardless.
    h = await createHarness({
      provider: answersUselessly,
      env: {
        MAX_CALLS_PER_TASK: '2',
        MAX_CALLS_UNTIL_RESULT: '9',
        MAX_CALLS_PER_USER_PER_DAY: '3',
        CALL_WAVE_SIZE: '2',
      },
      discovery: manyBusinesses(20),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('asking Dial to ring the best option back', () => {
  const USEFUL: CallProvider = {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      return snapshot({
        providerCallId: `g_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
        structuredResult: { can_repair: 'yes', quoted_price: 120, currency: 'EUR' },
        summary: 'Quoted EUR 120.',
        taskCompleted: true,
      });
    },
    async get(id) {
      return snapshot({ providerCallId: id, structuredResult: { can_repair: 'yes' } });
    },
  };

  async function taskWithABest() {
    const harness = await createHarness({
      provider: USEFUL,
      interpreter: stubInterpreter((instruction: string) => ({
        task: {
          ...REPAIR_TASK,
          callPurpose: 'ask about the repair',
          requestedSideEffect: /book|appointment|order/i.test(instruction)
            ? ('appointment' as const)
            : ('information_only' as const),
        },
        callFamily: 'repair_quote' as const,
      })),
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100' })],
      }),
    });
    const { token } = await signUp(harness);
    const created = await createTask(harness, token, 'How much for a screen repair in Dublin 2?');
    await harness.runner.drain();
    return { harness, token, id: created.id };
  }

  async function act(h: Harness, token: string, id: string, candidateId: string, instruction: string) {
    return h.app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/act-on-business`,
      headers: { authorization: `Bearer ${token}` },
      payload: { candidateId, instruction },
    });
  }

  it('starts a task that rings that business to do what was asked', async () => {
    const { harness, token, id } = await taskWithABest();
    h = harness;

    const detail = await getTaskDetail(h, token, id);
    const best = detail.result?.best;
    expect(best).toBeTruthy();

    const response = await act(h, token, id, best.candidate.id, 'Book me in for tomorrow morning');
    expect(response.statusCode).toBe(200);

    const started = response.json();
    expect(started.id).not.toBe(id);
    expect(started.instruction).toBe('Book me in for tomorrow morning');
  });

  it('is gated by the user’s policy like any other commitment', async () => {
    // The instruction is the user's own words, but an appointment is still a
    // commitment and the policy still decides.
    const { harness, token, id } = await taskWithABest();
    h = harness;

    const best = (await getTaskDetail(h, token, id)).result!.best!;
    const started = (await act(h, token, id, best.candidate.id, 'Book me in for tomorrow')).json();
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, started.id);
    expect(['awaiting_confirmation', 'failed', 'completed', 'partially_completed']).toContain(
      detail.state,
    );
    if (detail.state === 'awaiting_confirmation') expect(detail.calls).toHaveLength(0);
  });

  it('refuses a business that is not part of the task', async () => {
    const { harness, token, id } = await taskWithABest();
    h = harness;

    const response = await act(h, token, id, 'not-a-candidate', 'Book me in');
    expect(response.statusCode).toBe(404);
  });

  it('refuses an empty instruction', async () => {
    // Ringing somebody with nothing to say to them is the one thing this must
    // never do.
    const { harness, token, id } = await taskWithABest();
    h = harness;

    const best = (await getTaskDetail(h, token, id)).result!.best!;
    const response = await act(h, token, id, best.candidate.id, '  ');
    expect(response.statusCode).toBe(400);
  });

  it('refuses another user’s task', async () => {
    const { harness, token, id } = await taskWithABest();
    h = harness;
    const best = (await getTaskDetail(h, token, id)).result!.best!;
    const stranger = await signUp(h, 'stranger@example.com');

    const response = await act(h, stranger.token, id, best.candidate.id, 'Book me in');
    expect(response.statusCode).toBe(404);
  });
});

describe('how many comparable answers are enough', () => {
  /** Every business answers usefully, so only the target decides when to stop. */
  const alwaysUseful: CallProvider = {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      return snapshot({
        providerCallId: `a_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
        structuredResult: { can_repair: 'yes', quoted_price: 100, currency: 'EUR' },
        summary: 'Quoted EUR 100.',
        taskCompleted: true,
      });
    },
    async get(id) {
      return snapshot({ providerCallId: id, structuredResult: { can_repair: 'yes' } });
    },
  };

  it('keeps going past two, which used to be the whole comparison', async () => {
    // Two quotes is a thin basis for telling somebody which is cheapest, and
    // stopping there ended tasks after three calls.
    h = await createHarness({
      provider: alwaysUseful,
      env: { COMPARABLE_TARGET: '4', MAX_CALLS_PER_TASK: '3', CALL_WAVE_SIZE: '3' },
      discovery: manyBusinesses(12),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest screen repair in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.result?.tally.comparable).toBeGreaterThanOrEqual(4);
  });

  it('stops as soon as the goal is met', async () => {
    // The target is the goal, not a licence to keep ringing.
    h = await createHarness({
      provider: alwaysUseful,
      env: { COMPARABLE_TARGET: '3', MAX_CALLS_PER_TASK: '3', MAX_CALLS_UNTIL_RESULT: '10', CALL_WAVE_SIZE: '3' },
      discovery: manyBusinesses(20),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest screen repair in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBe(3);
  });

  it('lets the request name its own number', async () => {
    // "Ring five places" is the user saying what enough means.
    h = await createHarness({
      provider: alwaysUseful,
      env: { COMPARABLE_TARGET: '2', MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '10', CALL_WAVE_SIZE: '2' },
      interpreter: stubInterpreter(() => ({
        task: {
          ...REPAIR_TASK,
          constraints: { ...REPAIR_TASK.constraints, candidateLimit: 5 },
        },
        callFamily: 'repair_quote' as const,
      })),
      discovery: manyBusinesses(12),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Ring five places for a screen repair price');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.result?.tally.comparable).toBeGreaterThanOrEqual(5);
  });

  it('is still bounded when the goal cannot be met', async () => {
    h = await createHarness({
      provider: answersUselessly,
      env: { COMPARABLE_TARGET: '5', MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '6', CALL_WAVE_SIZE: '2' },
      discovery: manyBusinesses(40),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest screen repair in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeLessThanOrEqual(6);
    expect(['completed', 'partially_completed', 'failed']).toContain(detail.state);
  });
});

describe('one call at a time', () => {
  /**
   * Records how many calls were in flight at once.
   *
   * Three phones ringing simultaneously is three real people interrupted for a
   * question the first of them may already have answered, and the user watching
   * sees a row of calls in flight with no idea which will come back.
   */
  function watchingConcurrency() {
    const state = { inFlight: 0, peak: 0 };
    const provider: CallProvider = {
      name: 'fake',
      placesRealCalls: false,
      async create(request) {
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        // Left in flight: it is the poll that resolves it, which is what a real
        // call does and what makes overlap visible.
        return snapshot({
          providerCallId: `s_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
          status: 'in_progress',
          completedAt: null,
        });
      },
      async get(id) {
        state.inFlight = Math.max(0, state.inFlight - 1);
        return snapshot({
          providerCallId: id,
          structuredResult: { can_repair: 'unknown' },
          summary: 'They could not say.',
        });
      },
    };
    return { state, provider };
  }

  it('never has two calls in flight', async () => {
    const { state, provider } = watchingConcurrency();
    h = await createHarness({
      provider,
      env: { MAX_CALLS_PER_TASK: '4', MAX_CALLS_UNTIL_RESULT: '4', CALL_POLL_DELAY_MS: '1' },
      discovery: manyBusinesses(8),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();


    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeGreaterThan(1);
    expect(state.peak).toBe(1);
  });

  it('starts the next one only after the last has finished', async () => {
    const { provider } = watchingConcurrency();
    h = await createHarness({
      provider,
      env: { MAX_CALLS_PER_TASK: '3', MAX_CALLS_UNTIL_RESULT: '3', CALL_POLL_DELAY_MS: '1' },
      discovery: manyBusinesses(8),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    // Each business gets its own wave, so they are dialled in order rather
    // than in a batch.
    const names = detail.calls.map((c: any) => c.businessName);
    expect(new Set(names).size).toBe(names.length);
    expect(detail.calls.every((c: any) => c.disposition !== 'pending')).toBe(true);
  });
});
