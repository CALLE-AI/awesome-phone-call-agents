import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
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
 * Pausing a task.
 *
 * Two things have to hold: Dial starts nothing new, and the clock stops. What
 * pausing cannot do is pull back a call already in flight -- CALL-E exposes no
 * cancellation -- so a live call finishes and its answer is still recorded.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/**
 * Stays on the call.
 *
 * The default fake answers immediately, which finishes the whole task inside
 * one drain and leaves nothing to pause. A call that is still in flight is the
 * situation pausing is actually for.
 */
function snapshot(over: Partial<ProviderCallSnapshot> = {}): ProviderCallSnapshot {
  return {
    providerCallId: 'call_test',
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
    ...over,
  };
}

const stillOnTheCall: CallProvider = {
  name: 'fake',
  placesRealCalls: false,
  async create(request) {
    return snapshot({ providerCallId: `c_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}` });
  },
  async get(providerCallId) {
    return snapshot({ providerCallId });
  },
};

const DISCOVERY = stubDiscovery({
  candidates: [
    candidate({ id: 'a', name: 'First Shop', phoneE164: '+35315550100', distanceMeters: 400 }),
    candidate({ id: 'b', name: 'Second Shop', phoneE164: '+35315550101', distanceMeters: 800 }),
    candidate({ id: 'c', name: 'Third Shop', phoneE164: '+35315550102', distanceMeters: 1200 }),
  ],
});

function post(url: string, token: string) {
  return h.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } });
}

async function readTask(id: string) {
  const rows = await h.handle.db.execute<{
    state: string;
    paused_at: string | null;
    active_ms: number;
    active_since: string | null;
  }>(sql`SELECT state, paused_at, active_ms, active_since FROM tasks WHERE id = ${id}`);
  const row = rows.rows[0]!;
  return {
    state: row.state,
    pausedAt: row.paused_at,
    activeMs: Number(row.active_ms),
    activeSince: row.active_since,
  };
}

async function countCalls(taskId: string) {
  const rows = await h.handle.db
    .select()
    .from(calls)
    .where(sql`${calls.taskId} = ${taskId}`);
  return { total: rows.length, dispatched: rows.filter((c) => c.providerCallId).length };
}

describe('pausing a task', () => {
  it('stops the clock and banks what has run so far', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    // Pretend the current period has been running a while.
    await h.handle.db.execute(
      sql`UPDATE tasks SET active_since = now() - interval '40 seconds' WHERE id = ${created.id}`,
    );

    const response = await post(`/api/tasks/${created.id}/pause`, user.token);
    expect(response.statusCode).toBe(200);

    const paused = await readTask(created.id);
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.activeSince).toBeNull();
    expect(paused.activeMs).toBeGreaterThanOrEqual(39_000);

    // However long it stays paused, the total does not move.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await readTask(created.id)).activeMs).toBe(paused.activeMs);
  });

  it('does not dial anybody new while paused', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    const before = await countCalls(created.id);
    await post(`/api/tasks/${created.id}/pause`, user.token);

    // Let every queued job have its turn. None of them may ring a phone.
    await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
    await h.runner.drain();
    await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
    await h.runner.drain();

    expect((await countCalls(created.id)).dispatched).toBe(before.dispatched);
  });

  it('keeps the state it was in, and says so in the timeline', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    const before = await readTask(created.id);
    await post(`/api/tasks/${created.id}/pause`, user.token);

    // Paused is not a state: resuming has to know where it was.
    expect((await readTask(created.id)).state).toBe(before.state);

    const detail = await getTaskDetail(h, user.token, created.id);
    expect(detail.events.some((e) => e.message === 'Paused')).toBe(true);
  });

  it('resumes from the banked total rather than from zero', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    await h.handle.db.execute(
      sql`UPDATE tasks SET active_since = now() - interval '40 seconds' WHERE id = ${created.id}`,
    );
    await post(`/api/tasks/${created.id}/pause`, user.token);
    const banked = (await readTask(created.id)).activeMs;

    const resumed = await post(`/api/tasks/${created.id}/resume`, user.token);
    expect(resumed.statusCode).toBe(200);

    const after = await readTask(created.id);
    expect(after.pausedAt).toBeNull();
    expect(after.activeMs).toBe(banked);
    expect(after.activeSince).not.toBeNull();
  });

  it('does nothing at all while paused, then runs when resumed', async () => {
    // Paused before any work: not one stage may proceed. The earlier stages
    // are deferred rather than dropped, so resuming picks the task up from
    // wherever it had got to instead of leaving it stuck there.
    h = await createHarness({ discovery: DISCOVERY, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');

    expect((await post(`/api/tasks/${created.id}/pause`, user.token)).statusCode).toBe(200);

    for (let i = 0; i < 3; i += 1) {
      await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
      await h.runner.drain();
    }

    const whilePaused = await readTask(created.id);
    expect(whilePaused.state).toBe('created');
    expect((await countCalls(created.id)).dispatched).toBe(0);

    await post(`/api/tasks/${created.id}/resume`, user.token);
    for (let i = 0; i < 3; i += 1) {
      await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
      await h.runner.drain();
    }

    // It got going, and rang somebody.
    expect((await readTask(created.id)).state).not.toBe('created');
    expect((await countCalls(created.id)).dispatched).toBeGreaterThan(0);
  });

  it('refuses to pause twice, or to resume something that is running', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    expect((await post(`/api/tasks/${created.id}/resume`, user.token)).statusCode).toBe(409);
    expect((await post(`/api/tasks/${created.id}/pause`, user.token)).statusCode).toBe(200);
    expect((await post(`/api/tasks/${created.id}/pause`, user.token)).statusCode).toBe(409);
    expect((await post(`/api/tasks/${created.id}/resume`, user.token)).statusCode).toBe(200);
  });

  it('is nobody else’s task to pause', async () => {
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const alice = await signUp(h);
    const bob = await signUp(h);
    const created = await createTask(h, alice.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    expect((await post(`/api/tasks/${created.id}/pause`, bob.token)).statusCode).toBe(404);
    const anonymous = await h.app.inject({ method: 'POST', url: `/api/tasks/${created.id}/pause` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('does not fail a paused task for being inactive', async () => {
    // The stall detector exists to catch a task nothing is happening on. A
    // task the user deliberately stopped is not that.
    h = await createHarness({ discovery: DISCOVERY, provider: stillOnTheCall, env: { CALL_WAVE_SIZE: '1' } });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();
    await post(`/api/tasks/${created.id}/pause`, user.token);

    // Age everything well past the stall timeout and let the detector run.
    await h.handle.db.execute(sql`
      UPDATE task_events SET created_at = now() - interval '2 hours' WHERE task_id = ${created.id}`);
    await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
    await h.runner.drain();

    const after = await readTask(created.id);
    expect(after.state).not.toBe('failed');
    expect(after.pausedAt).not.toBeNull();
  });
});
