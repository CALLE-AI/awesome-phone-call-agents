import { describe, it, expect, afterEach } from 'vitest';
import { tasks } from '@dial/database';
import { createHarness, signUp, type Harness } from './harness.js';

/**
 * Home-screen suggestions.
 *
 * These are shown unprompted, to whoever is looking at the screen, so what is
 * excluded matters more than what is included. The tests below are mostly
 * about the exclusions.
 */

let h: Harness;

afterEach(async () => {
  await h?.close();
});

interface SuggestionsBody {
  suggestions: Array<{
    domain: string;
    instruction: string;
    timesUsed: number;
    lastUsedAt: string;
    locationLabel: string | null;
  }>;
}

async function suggestions(token: string, limit?: number) {
  const response = await h.app.inject({
    method: 'GET',
    url: limit === undefined ? '/api/suggestions' : `/api/suggestions?limit=${limit}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.statusCode, body: response.json() as SuggestionsBody };
}

/**
 * Writes a finished task directly. The pipeline is exercised elsewhere; what
 * matters here is which stored rows the query is willing to offer back.
 */
async function completedTask(
  userId: string,
  options: {
    id: string;
    instruction: string;
    domain: string;
    sensitivity?: string;
    state?: string;
    withBest?: boolean;
    locationLabel?: string | null;
    updatedAt?: string;
  },
) {
  const best = options.withBest === false ? null : { candidate: { id: 'c1', name: 'Somewhere' } };
  await h.handle.db.insert(tasks).values({
    id: options.id,
    userId,
    idempotencyKey: `idem-${options.id}`,
    instruction: options.instruction,
    state: options.state ?? 'completed',
    interpreted: {
      objective: options.instruction,
      domain: options.domain,
      sensitivity: options.sensitivity ?? 'normal',
    },
    result: { headline: 'done', best, alternatives: [], unusable: [], tally: {}, caveats: [] },
    locationLabel: options.locationLabel ?? 'Dublin 2',
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  });
}

describe('history suggestions', () => {
  it('needs a session', async () => {
    h = await createHarness({});
    const anonymous = await h.app.inject({ method: 'GET', url: '/api/suggestions' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('offers nothing to an account with no history', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const { status, body } = await suggestions(user.token);
    expect(status).toBe(200);
    expect(body.suggestions).toEqual([]);
  });

  it('offers back a task that produced a verified result', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    await completedTask(user.userId, {
      id: 'task_a',
      instruction: 'Find the cheapest iPhone screen repair',
      domain: 'phone_repair',
    });

    const { body } = await suggestions(user.token);
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({
      domain: 'phone_repair',
      instruction: 'Find the cheapest iPhone screen repair',
      timesUsed: 1,
      locationLabel: 'Dublin 2',
    });
  });

  it('counts a domain once, carrying the most recent wording', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    await completedTask(user.userId, {
      id: 'task_a',
      instruction: 'Get a plumber quote',
      domain: 'plumbing',
      updatedAt: '2026-08-01T10:00:00.000Z',
    });
    await completedTask(user.userId, {
      id: 'task_b',
      instruction: 'Three quotes for a leaking tap',
      domain: 'plumbing',
      updatedAt: '2026-08-20T10:00:00.000Z',
    });

    const { body } = await suggestions(user.token);
    // Five variations of "plumber" are one suggestion, not five.
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({
      domain: 'plumbing',
      instruction: 'Three quotes for a leaking tap',
      timesUsed: 2,
    });
  });

  it('puts the domain you return to most at the top', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    await completedTask(user.userId, { id: 't1', instruction: 'Burger place', domain: 'restaurant', updatedAt: '2026-08-01T10:00:00.000Z' });
    await completedTask(user.userId, { id: 't2', instruction: 'Another burger', domain: 'restaurant', updatedAt: '2026-08-02T10:00:00.000Z' });
    await completedTask(user.userId, { id: 't3', instruction: 'A plumber', domain: 'plumbing', updatedAt: '2026-08-25T10:00:00.000Z' });

    const { body } = await suggestions(user.token);
    expect(body.suggestions.map((s) => s.domain)).toEqual(['restaurant', 'plumbing']);
  });

  it('never offers back a sensitive request', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    // The interpreter classifies these precisely because they matter. A
    // pharmacy prompt on the home screen is visible to anyone looking at the
    // screen, which is not a trade worth making for convenience.
    for (const [index, sensitivity] of ['medical', 'financial', 'legal', 'high_risk', 'personal'].entries()) {
      await completedTask(user.userId, {
        id: `task_s${index}`,
        instruction: 'Check if my prescription is ready',
        domain: `pharmacy_${index}`,
        sensitivity,
      });
    }
    await completedTask(user.userId, {
      id: 'task_ok',
      instruction: 'Find a burger',
      domain: 'restaurant',
    });

    const { body } = await suggestions(user.token);
    expect(body.suggestions.map((s) => s.domain)).toEqual(['restaurant']);
  });

  it('does not offer back a task that failed or found nothing', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    await completedTask(user.userId, {
      id: 'task_failed',
      instruction: 'Nobody answered',
      domain: 'locksmith',
      state: 'failed',
    });
    await completedTask(user.userId, {
      id: 'task_nothing',
      instruction: 'Everyone answered, nobody could help',
      domain: 'upholstery',
      // Completed, but no verified best option -- nothing worth repeating.
      withBest: false,
    });

    const { body } = await suggestions(user.token);
    expect(body.suggestions).toEqual([]);
  });

  it('is scoped to the account asking', async () => {
    h = await createHarness({});
    const alice = await signUp(h);
    const bob = await signUp(h);
    await completedTask(alice.userId, {
      id: 'task_a',
      instruction: 'Find a burger',
      domain: 'restaurant',
    });

    expect((await suggestions(alice.token)).body.suggestions).toHaveLength(1);
    expect((await suggestions(bob.token)).body.suggestions).toEqual([]);
  });

  it('clamps the limit rather than returning a whole history', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    for (let i = 0; i < 15; i += 1) {
      await completedTask(user.userId, {
        id: `task_${i}`,
        instruction: `Task ${i}`,
        domain: `domain_${i}`,
      });
    }

    expect((await suggestions(user.token)).body.suggestions).toHaveLength(4);
    expect((await suggestions(user.token, 2)).body.suggestions).toHaveLength(2);
    expect((await suggestions(user.token, 500)).body.suggestions).toHaveLength(12);
    expect((await suggestions(user.token, -1)).body.suggestions).toHaveLength(4);
  });
});
