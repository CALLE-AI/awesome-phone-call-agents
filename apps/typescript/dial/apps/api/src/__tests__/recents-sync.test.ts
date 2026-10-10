import { describe, it, expect, afterEach } from 'vitest';
import { groupTasksByDay, taskSummaryLine } from '@dial/schemas';
import { sql } from 'drizzle-orm';
import {
  createHarness,
  signUp,
  createTask,
  stubDiscovery,
  candidate,
  type Harness,
} from './harness.js';

/**
 * The sidebar's recents.
 *
 * A newly created task did not appear until the page was reloaded. These pin
 * the half of it the server owns: the list must contain the task the moment it
 * is created, and it must be at the top. Anything still missing after that is
 * the client not re-rendering, which is where the fix went.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

async function listTasks(token: string) {
  const response = await h.app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { authorization: `Bearer ${token}` },
  });
  return (response.json() as { tasks: Array<{ id: string; instruction: string }> }).tasks;
}

describe('recents', () => {
  it('contains a task the instant it is created', async () => {
    h = await createHarness({});
    const user = await signUp(h);

    expect(await listTasks(user.token)).toHaveLength(0);

    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    // No drain, no waiting: the row exists as soon as the request returns.
    const tasks = await listTasks(user.token);
    expect(tasks.map((t) => t.id)).toContain(created.id);
  });

  it('puts the newest first, so it lands at the top of the list', async () => {
    h = await createHarness({});
    const user = await signUp(h);

    const first = await createTask(h, user.token, 'First task');
    const second = await createTask(h, user.token, 'Second task');
    const third = await createTask(h, user.token, 'Third task');

    const tasks = await listTasks(user.token);
    expect(tasks.map((t) => t.id)).toEqual([third.id, second.id, first.id]);
  });
});

describe('history, grouped by day', () => {
  /**
   * A flat run of forty rows all looked equally recent. Grouping needs two
   * things the list did not carry: which day a task belongs to, and enough of
   * a summary to be worth reading -- "Completed · 6 calls".
   */
  it('reports how many businesses were actually dialled', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'a', name: 'One', phoneE164: '+35315550100' }),
          candidate({ id: 'b', name: 'Two', phoneE164: '+35315550101' }),
        ],
      }),
    });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    const [task] = await listTasks(user.token);
    expect(task!.id).toBe(created.id);
    expect(task!.callCount).toBeGreaterThan(0);
    expect(taskSummaryLine(task!)).toMatch(/\d+ calls?$/);
  });

  it('counts phones rung, not rows planned', async () => {
    // A planned call that was never dispatched has rung nobody, and saying
    // "6 calls" about it would be a claim Dial cannot support.
    h = await createHarness({});
    const user = await signUp(h);
    await createTask(h, user.token, 'Find an iPhone repair shop');

    const [task] = await listTasks(user.token);
    expect(task!.callCount).toBe(0);
    expect(taskSummaryLine(task!)).not.toMatch(/call/);
  });

  it('carries the domain, so a row can be marked with what it was about', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'One', phoneE164: '+35315550100' })],
      }),
    });
    const user = await signUp(h);
    await createTask(h, user.token, 'Find an iPhone repair shop');
    await h.runner.drain();

    const [task] = await listTasks(user.token);
    expect(task!.domain).toBeTruthy();
  });

  it('splits the list into days without reordering it', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    for (const instruction of ['First', 'Second', 'Third']) {
      await createTask(h, user.token, `${instruction} task to run`);
    }

    const tasks = await listTasks(user.token);
    // Age one of them so there is more than one day to group by.
    await h.handle.db.execute(
      sql`UPDATE tasks SET created_at = now() - interval '2 days' WHERE id = ${tasks[2]!.id}`,
    );

    const grouped = groupTasksByDay(await listTasks(user.token));
    expect(grouped.length).toBe(2);
    expect(grouped[0]!.label).toBe('Today');
    expect(grouped[0]!.tasks).toHaveLength(2);
    // The order the server returned is preserved inside each group.
    expect(grouped.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(
      (await listTasks(user.token)).map((t) => t.id),
    );
  });

  it('counts each task once, however many tasks are on the page', async () => {
    // The count is one aggregate query for the whole page, not one per task.
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'One', phoneE164: '+35315550100' })],
      }),
    });
    const user = await signUp(h);
    await createTask(h, user.token, 'First task to run');
    await h.runner.drain();
    await createTask(h, user.token, 'Second task to run');
    await h.runner.drain();

    const tasks = await listTasks(user.token);
    expect(tasks).toHaveLength(2);
    for (const task of tasks) expect(task.callCount).toBeGreaterThan(0);
  });
});
