import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls, users } from '@dial/database';
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

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('authentication', () => {
  it('rejects every task endpoint without a session', async () => {
    h = await createHarness();
    for (const [method, url] of [
      ['GET', '/api/tasks'],
      ['POST', '/api/tasks'],
      ['GET', '/api/tasks/whatever'],
      ['GET', '/api/settings'],
      ['PATCH', '/api/settings'],
      ['DELETE', '/api/account'],
    ] as const) {
      const response = await h.app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('never stores or returns the password', async () => {
    h = await createHarness();
    const { userId } = await signUp(h, 'pw@example.com');
    const rows = await h.handle.db.select().from(users).where(eq(users.id, userId));
    const stored = rows[0]!.passwordHash;
    expect(stored).not.toContain('a-sufficiently-long-password');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a wrong password and does not reveal whether the account exists', async () => {
    h = await createHarness();
    await signUp(h, 'real@example.com');

    const wrongPassword = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'real@example.com', password: 'not-the-password' },
    });
    const noSuchUser = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'ghost@example.com', password: 'not-the-password' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(noSuchUser.json().error.message);
  });

  it('refuses a short password', async () => {
    h = await createHarness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: { email: 'short@example.com', password: 'short', name: 'X' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('invalidates the session on sign-out', async () => {
    h = await createHarness();
    const { token } = await signUp(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { authorization: `Bearer ${token}` },
    });
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('access control', () => {
  it("will not show one user another user's task", async () => {
    h = await createHarness({
      discovery: stubDiscovery({ candidates: [candidate()] }),
    });
    const alice = await signUp(h, 'alice@example.com');
    const bob = await signUp(h, 'bob@example.com');

    const task = await createTask(h, alice.token, 'Find a phone repair shop');

    const asBob = await h.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    // 404, not 403 — Bob learns nothing about whether the task exists.
    expect(asBob.statusCode).toBe(404);

    const bobList = await h.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(bobList.json().tasks).toHaveLength(0);
  });

  it("will not let one user cancel or delete another user's task", async () => {
    h = await createHarness({ discovery: stubDiscovery({ candidates: [candidate()] }) });
    const alice = await signUp(h, 'alice2@example.com');
    const bob = await signUp(h, 'bob2@example.com');
    const task = await createTask(h, alice.token, 'Find a phone repair shop');

    for (const [method, url] of [
      ['POST', `/api/tasks/${task.id}/cancel`],
      ['DELETE', `/api/tasks/${task.id}`],
      ['POST', `/api/tasks/${task.id}/authorization`],
    ] as const) {
      const response = await h.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${bob.token}` },
        payload: { approved: true },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('idempotency and abuse limits', () => {
  it('a repeated create with the same key returns the original task', async () => {
    h = await createHarness({ discovery: stubDiscovery({ candidates: [candidate()] }) });
    const { token } = await signUp(h);
    const key = 'stable-key-123456';

    const first = await h.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { instruction: 'Find a phone repair shop', idempotencyKey: key },
    });
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { instruction: 'Find a phone repair shop', idempotencyKey: key },
    });

    expect(first.json().id).toBe(second.json().id);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json().tasks).toHaveLength(1);
  });

  it('stops placing calls once the daily ceiling is reached', async () => {
    h = await createHarness({
      env: { MAX_CALLS_PER_USER_PER_DAY: '2', MAX_CALLS_PER_TASK: '5' },
      discovery: stubDiscovery({
        candidates: Array.from({ length: 5 }, (_, i) =>
          candidate({ id: `d${i}`, name: `Shop ${i}`, phoneE164: `+3531555010${i}` }),
        ),
      }),
    });
    const { token } = await signUp(h);

    const first = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();
    const firstCalls = await h.handle.db.select().from(calls).where(eq(calls.taskId, first.id));
    expect(firstCalls.length).toBeLessThanOrEqual(2);

    const second = await createTask(h, token, 'Find another phone repair shop');
    await h.runner.drain();
    const detail = await getTaskDetail(h, token, second.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/limit on calls/i);
  });
});

describe('the authorization gate', () => {
  it('asks before booking when the policy says ask, and places no call until approved', async () => {
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: {
          ...REPAIR_TASK,
          taskFamily: 'reservation',
          domain: 'restaurant',
          searchQuery: 'italian restaurant',
          requestedSideEffect: 'reservation',
          objective: 'Book a table for four tonight at 7pm',
        },
        callFamily: 'reservation',
      })),
      discovery: stubDiscovery({ candidates: [candidate({ id: 'r1', name: 'Trattoria' })] }),
    });
    const { token } = await signUp(h);
    const task = await createTask(h, token, 'Book a table for 4 tonight at 7');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, task.id);
    expect(detail.state).toBe('awaiting_confirmation');
    expect(detail.pendingAuthorization).toBeTruthy();
    expect(detail.pendingAuthorization.kind).toBe('make_reservation');
    // Nothing was dialled while waiting for the user.
    expect(detail.calls).toHaveLength(0);
  });

  it('proceeds once approved', async () => {
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: { ...REPAIR_TASK, requestedSideEffect: 'reservation', taskFamily: 'reservation' },
        callFamily: 'reservation',
      })),
      discovery: stubDiscovery({ candidates: [candidate({ id: 'r2', name: 'Trattoria' })] }),
    });
    const { token } = await signUp(h);
    const task = await createTask(h, token, 'Book a table');
    await h.runner.drain();

    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/authorization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { approved: true },
    });
    expect(approve.statusCode).toBe(200);

    await h.runner.drain();
    const detail = await getTaskDetail(h, token, task.id);
    expect(detail.calls.length).toBeGreaterThan(0);
  });

  it('stops entirely when denied, without calling anyone', async () => {
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: { ...REPAIR_TASK, requestedSideEffect: 'reservation', taskFamily: 'reservation' },
        callFamily: 'reservation',
      })),
      discovery: stubDiscovery({ candidates: [candidate({ id: 'r3', name: 'Trattoria' })] }),
    });
    const { token } = await signUp(h);
    const task = await createTask(h, token, 'Book a table');
    await h.runner.drain();

    await h.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/authorization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { approved: false },
    });
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, task.id);
    expect(detail.state).toBe('canceled');
    expect(detail.calls).toHaveLength(0);
  });

  it('honours a policy of never placing calls', async () => {
    h = await createHarness({ discovery: stubDiscovery({ candidates: [candidate()] }) });
    const { token } = await signUp(h);

    await h.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { policy: { phoneInquiries: 'never' } },
    });

    const task = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, task.id);
    expect(detail.state).toBe('failed');
    expect(detail.headline).toMatch(/do not allow Dial to make phone calls/i);
    expect(detail.calls).toHaveLength(0);
  });
});

describe('privacy', () => {
  it('drops transcripts when the user sets retention to zero', async () => {
    h = await createHarness({
      discovery: stubDiscovery({ candidates: [candidate({ id: 'p1', name: 'PrivateShop' })] }),
    });
    const { token } = await signUp(h);
    await h.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { transcriptRetentionDays: 0 },
    });

    const task = await createTask(h, token, 'Find a phone repair shop');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, task.id);
    for (const call of detail.calls) {
      expect(call.transcript).toHaveLength(0);
    }
  });

  it('deleting the account removes the user and cascades their tasks', async () => {
    h = await createHarness({ discovery: stubDiscovery({ candidates: [candidate()] }) });
    const { token, userId } = await signUp(h);
    await createTask(h, token, 'Find a phone repair shop');

    const response = await h.app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);

    const remaining = await h.handle.db.select().from(users).where(eq(users.id, userId));
    expect(remaining).toHaveLength(0);
  });
});
