import { describe, it, expect, afterEach } from 'vitest';
import {
  createHarness,
  signUp,
  createTask,
  stubDiscovery,
  candidate,
  type Harness,
} from './harness.js';

/**
 * The Usage page.
 *
 * Its whole value is that the number shown is the number that actually
 * limited the work, so these read it back through the API after real calls
 * have been placed rather than asserting on a separately kept tally.
 */

let h: Harness;

afterEach(async () => {
  await h?.close();
});

async function usage(token: string, days?: number) {
  const response = await h.app.inject({
    method: 'GET',
    url: days === undefined ? '/api/usage' : `/api/usage?days=${days}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.statusCode, body: response.json() as UsageBody };
}

interface UsageBody {
  today: { day: string; callsPlaced: number; tasksCreated: number };
  history: Array<{ day: string; callsPlaced: number; tasksCreated: number }>;
  totals: { callsPlaced: number; tasksCreated: number };
  limits: { callsPerDay: number; callsPerTask: number };
}

describe('usage', () => {
  it('needs a session', async () => {
    h = await createHarness({});
    const anonymous = await h.app.inject({ method: 'GET', url: '/api/usage' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('starts at zero and still returns a full window of days', async () => {
    h = await createHarness({});
    const user = await signUp(h);

    const { status, body } = await usage(user.token);
    expect(status).toBe(200);
    expect(body.today.callsPlaced).toBe(0);
    expect(body.totals.callsPlaced).toBe(0);
    // Days with no activity have no row. They are filled in as zeroes so a
    // chart of the fortnight has a bar for every day rather than gaps.
    expect(body.history).toHaveLength(14);
    expect(body.history.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
    expect(body.history[body.history.length - 1]!.day).toBe(body.today.day);
  });

  it('reports the ceilings that actually bound the work', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const { body } = await usage(user.token);
    expect(body.limits.callsPerDay).toBeGreaterThan(0);
    expect(body.limits.callsPerTask).toBeGreaterThan(0);
  });

  it('counts the calls a task really placed', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100', distanceMeters: 900 }),
          candidate({ id: 'b', name: 'MobileCare', phoneE164: '+35315550101', distanceMeters: 1400 }),
        ],
      }),
    });
    const user = await signUp(h);

    const before = await usage(user.token);
    expect(before.body.today.callsPlaced).toBe(0);

    await createTask(h, user.token, 'Find the cheapest iPhone screen repair');
    await h.runner.drain();

    const after = await usage(user.token);
    expect(after.body.today.tasksCreated).toBeGreaterThan(0);
    expect(after.body.today.callsPlaced).toBeGreaterThan(0);
    // Today is the last bucket, and the totals are the sum of the window.
    expect(after.body.history[after.body.history.length - 1]!.callsPlaced).toBe(
      after.body.today.callsPlaced,
    );
    expect(after.body.totals.callsPlaced).toBe(after.body.today.callsPlaced);
  });

  it('is scoped to the account asking', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100', distanceMeters: 900 }),
        ],
      }),
    });
    const alice = await signUp(h);
    const bob = await signUp(h);

    await createTask(h, alice.token, 'Find the cheapest iPhone screen repair');
    await h.runner.drain();

    const hers = await usage(alice.token);
    const his = await usage(bob.token);
    expect(hers.body.today.callsPlaced).toBeGreaterThan(0);
    expect(his.body.today.callsPlaced).toBe(0);
    expect(his.body.totals.tasksCreated).toBe(0);
  });

  it('clamps an absurd window rather than scanning forever', async () => {
    h = await createHarness({});
    const user = await signUp(h);

    expect((await usage(user.token, 100000)).body.history).toHaveLength(90);
    expect((await usage(user.token, 0)).body.history).toHaveLength(14);
    expect((await usage(user.token, -5)).body.history).toHaveLength(14);
  });
});
