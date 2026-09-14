import { describe, it, expect, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { calls } from '@dial/database';
import type { CallProvider, ProviderCallSnapshot } from '@dial/calle';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubDiscovery,
  candidate,
  type Harness,
} from './harness.js';

/**
 * Giving up on a business that does not answer, and trying another one.
 *
 * The wording throughout is deliberately "stopped waiting", not "cancelled":
 * CALL-E exposes no way to cancel a call in flight, so Dial can move on but
 * cannot stop a phone that is already ringing.
 */

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Never reaches a terminal state — the ring that goes on forever. */
const neverAnswers: CallProvider = {
  name: 'fake',
  placesRealCalls: false,
  async create(request): Promise<ProviderCallSnapshot> {
    return {
      providerCallId: `fake_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
      status: 'in_progress',
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      attempts: [],
      failureCode: null,
      failureMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  },
  async get(providerCallId): Promise<ProviderCallSnapshot> {
    return {
      providerCallId,
      status: 'in_progress',
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      attempts: [],
      failureCode: null,
      failureMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  },
};

/**
 * Makes pending jobs due, except the 15-minute safety net — pulling that
 * forward too would let it mark the calls failed before the answer budget is
 * ever evaluated, which is not the ordering production sees.
 */
async function dueNow(harness: Harness) {
  await harness.handle.db.execute(sql`
    UPDATE jobs SET run_at = now()
    WHERE state = 'pending' AND kind <> 'task.timeout'
  `);
}

/** Pretends the wait started long enough ago to have expired. */
async function agePendingCalls(harness: Harness, seconds: number) {
  await harness.handle.db.execute(sql`
    UPDATE calls
    SET waiting_since = now() - (${seconds} * interval '1 second'),
        dispatched_at = now() - (${seconds} * interval '1 second')
    WHERE disposition = 'pending'
  `);
}

describe('when a business does not answer', () => {
  it('stops waiting after the answer budget and says so plainly', async () => {
    h = await createHarness({
      provider: neverAnswers,
      env: {
        CALL_POLL_DELAY_MS: '60000',
        CALL_ANSWER_TIMEOUT_MS: '30000',
        CALL_MAX_ATTEMPTS_PER_BUSINESS: '2',
        MAX_CALLS_PER_TASK: '1',
      },
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'Never Answers', phoneE164: '+35315550100' })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop');
    await h.runner.drain();

    // Not yet: the budget is 2 x 30s and barely any time has passed.
    let detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls[0]?.disposition).toBe('pending');

    // 61 seconds later it gives up on this one.
    await agePendingCalls(h, 61);
    await dueNow(h);
    await h.runner.drain();

    detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls[0]?.disposition).toBe('no_answer');
    expect(detail.calls[0]?.failureCode).toBe('answer_timeout');
    expect(detail.calls[0]?.failureMessage).toMatch(/no answer within 60 seconds/i);

    const timeline = detail.events.map((e: any) => e.message).join(' ');
    expect(timeline).toMatch(/no answer after 60s/i);
    // It must not claim to have cancelled anything.
    expect(timeline).not.toMatch(/cancell?ed the call/i);
  });

  it('tries a different business instead', async () => {
    h = await createHarness({
      provider: neverAnswers,
      env: {
        CALL_POLL_DELAY_MS: '60000',
        CALL_ANSWER_TIMEOUT_MS: '30000',
        CALL_MAX_ATTEMPTS_PER_BUSINESS: '2',
        MAX_CALLS_PER_TASK: '3',
        CALL_WAVE_SIZE: '1',
      },
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'First Choice', phoneE164: '+35315550100', distanceMeters: 100 }),
          candidate({ id: 'b', name: 'Second Choice', phoneE164: '+35315550101', distanceMeters: 200 }),
          candidate({ id: 'c', name: 'Third Choice', phoneE164: '+35315550102', distanceMeters: 300 }),
        ],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop');
    await h.runner.drain();

    // Age and drain repeatedly: each round abandons one and moves to the next.
    for (let i = 0; i < 6; i += 1) {
      await agePendingCalls(h, 61);
      await dueNow(h);
      await h.runner.drain();
    }

    const rows = await h.handle.db.select().from(calls).where(eq(calls.taskId, created.id));
    const names = rows.map((r) => r.businessName);

    // More than one business was tried, and each only once.
    expect(new Set(names).size).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);

    const detail = await getTaskDetail(h, token, created.id);
    const timeline = detail.events.map((e: any) => e.message).join(' ');

    // Each business that went unanswered handed over to the next one.
    expect(timeline).toMatch(/no answer after 60s — trying another business/i);
    // And every one of them was actually dialled.
    for (const name of new Set(names)) {
      expect(timeline).toContain(`Calling ${name}`);
    }
  });

  it('stops somewhere rather than working through every business', async () => {
    h = await createHarness({
      provider: neverAnswers,
      env: {
        CALL_POLL_DELAY_MS: '60000',
        CALL_ANSWER_TIMEOUT_MS: '30000',
        CALL_MAX_ATTEMPTS_PER_BUSINESS: '2',
        MAX_CALLS_PER_TASK: '2',
        // Nobody answers here, so Dial keeps trying other businesses rather
        // than stopping at the ordinary ceiling with nothing to show. This is
        // the bound on that persistence.
        MAX_CALLS_UNTIL_RESULT: '4',
        CALL_WAVE_SIZE: '1',
      },
      discovery: stubDiscovery({
        candidates: Array.from({ length: 8 }, (_, i) =>
          candidate({ id: `x${i}`, name: `Shop ${i}`, phoneE164: `+3531555010${i}` }),
        ),
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop');

    for (let i = 0; i < 10; i += 1) {
      await agePendingCalls(h, 61);
      await dueNow(h);
      await h.runner.drain();
    }

    const rows = await h.handle.db.select().from(calls).where(eq(calls.taskId, created.id));
    // Eight businesses were available. Dial tried past the ordinary ceiling
    // because nothing usable had come back, and still stopped well short of
    // ringing all of them.
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.length).toBeLessThanOrEqual(4);

    const detail = await getTaskDetail(h, token, created.id);
    expect(['completed', 'partially_completed', 'failed']).toContain(detail.state);
    // Nobody answered, and the result says exactly that.
    expect(detail.headline).toMatch(/none answered|could not/i);
  });

  it('leaves a business that answers promptly completely alone', async () => {
    h = await createHarness({
      env: { CALL_ANSWER_TIMEOUT_MS: '30000', MAX_CALLS_PER_TASK: '2' },
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'Answers Fast', phoneE164: '+35315550100' }),
          candidate({ id: 'b', name: 'Also Fine', phoneE164: '+35315550101' }),
        ],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    for (const call of detail.calls) {
      expect(call.failureCode).not.toBe('answer_timeout');
    }
  });
});
