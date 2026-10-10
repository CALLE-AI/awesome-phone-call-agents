import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { setState } from '@dial/orchestrator';
import { elapsedWorkingMs, formatDuration } from '@dial/schemas';
import { tasks } from '@dial/database';
import { createHarness, signUp, type Harness } from './harness.js';

/**
 * The task timer.
 *
 * It answers "how long has Dial spent on this", which is not the same as how
 * long ago the task was created: a task can sit for an hour waiting for an
 * answer from the user, and none of that is Dial working.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

async function makeTask(userId: string, id = 'task_timer') {
  await h.handle.db.insert(tasks).values({
    id,
    userId,
    idempotencyKey: `idem-${id}`,
    instruction: 'Find an iPhone repair shop',
    state: 'created',
  });
  return id;
}

async function readClock(id: string) {
  const rows = await h.handle.db.execute<{ active_ms: number; active_since: string | null }>(
    sql`SELECT active_ms, active_since FROM tasks WHERE id = ${id}`,
  );
  const row = rows.rows[0]!;
  return { activeMs: Number(row.active_ms), activeSince: row.active_since };
}

/** Pretends the current period of work started `seconds` ago. */
async function backdate(id: string, seconds: number) {
  await h.handle.db.execute(
    sql`UPDATE tasks SET active_since = now() - (${seconds} * interval '1 second') WHERE id = ${id}`,
  );
}

describe('the task clock', () => {
  it('does not run before the work starts', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'interpreting');
    const clock = await readClock(id);
    // "Understanding request" is not the thing the timer is about.
    expect(clock.activeSince).toBeNull();
    expect(clock.activeMs).toBe(0);
  });

  it('starts when Dial starts searching', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'researching');
    const clock = await readClock(id);
    expect(clock.activeSince).not.toBeNull();
    expect(clock.activeMs).toBe(0);
  });

  it('keeps running across the states in between', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'researching');
    const started = (await readClock(id)).activeSince;

    for (const state of ['candidates_ready', 'planning_calls', 'calling', 'comparing'] as const) {
      await setState(h.ctx, id, state);
      const clock = await readClock(id);
      // Not restarted at each step, and nothing banked yet.
      expect(clock.activeSince).toBe(started);
      expect(clock.activeMs).toBe(0);
    }
  });

  it('banks the time and stops when the task finishes', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'researching');
    await backdate(id, 90);
    await setState(h.ctx, id, 'completed');

    const clock = await readClock(id);
    expect(clock.activeSince).toBeNull();
    expect(clock.activeMs).toBeGreaterThanOrEqual(89_000);
    expect(clock.activeMs).toBeLessThan(95_000);
  });

  it('resumes where it stopped when the task is asked to do more', async () => {
    // The case that matters: a finished task, then "call this one too".
    // Starting from zero would report a ninety-second task as a five-second one.
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'researching');
    await backdate(id, 90);
    await setState(h.ctx, id, 'completed');
    const banked = (await readClock(id)).activeMs;

    // The user picks another business; the task goes back to work.
    await setState(h.ctx, id, 'calling');
    const resumed = await readClock(id);
    expect(resumed.activeSince).not.toBeNull();
    expect(resumed.activeMs).toBe(banked);

    await backdate(id, 30);
    await setState(h.ctx, id, 'completed');

    const total = (await readClock(id)).activeMs;
    expect(total).toBeGreaterThanOrEqual(banked + 29_000);
    expect(total).toBeLessThan(banked + 35_000);
  });

  it('does not count time spent waiting for the user', async () => {
    // Dial is not working while a question sits unanswered. Counting it would
    // report a task as having taken three hours because somebody replied
    // after lunch.
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);

    await setState(h.ctx, id, 'researching');
    await backdate(id, 10);
    await setState(h.ctx, id, 'needs_user_input');

    const paused = await readClock(id);
    expect(paused.activeSince).toBeNull();

    // However long the person takes, the total does not move.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await readClock(id)).activeMs).toBe(paused.activeMs);
  });

  it('is reported to the client, and reads as a stopwatch', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const id = await makeTask(user.userId);
    await setState(h.ctx, id, 'researching');
    await backdate(id, 67);

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const body = response.json() as { activeMs: number; activeSince: string | null };

    expect(body.activeSince).not.toBeNull();
    const elapsed = elapsedWorkingMs(body);
    expect(elapsed).toBeGreaterThanOrEqual(66_000);
    expect(formatDuration(elapsed)).toMatch(/^1:0[6-9]$/);
  });
});
