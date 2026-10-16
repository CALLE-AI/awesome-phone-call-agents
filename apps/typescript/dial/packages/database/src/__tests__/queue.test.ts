import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, runMigrations, type DatabaseHandle } from '../client.js';
import { enqueueJob, claimJobs, completeJob, failJob, reclaimStaleJobs, queueDepth } from '../queue.js';

/**
 * These run against real PostgreSQL (PGlite = Postgres compiled to WASM), so the
 * migrations, constraints and SKIP LOCKED query are genuinely exercised.
 */

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createDatabase({ url: '', dataDir: 'memory://' });
  await runMigrations(handle.db);
}, 60_000);

afterAll(async () => {
  await handle?.close();
});

describe('migrations', () => {
  it('creates every table the application needs', async () => {
    const result = await handle.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set(result.rows.map((r) => r.table_name));
    for (const expected of [
      'users',
      'sessions',
      'user_settings',
      'tasks',
      'task_events',
      'business_candidates',
      'candidate_sources',
      'calls',
      'call_attempts',
      'authorization_requests',
      'processed_webhook_events',
      'audit_events',
      'notifications',
      'usage_counters',
      'jobs',
    ]) {
      expect(names.has(expected), `missing table ${expected}`).toBe(true);
    }
  });

  it('is idempotent — running again applies nothing', async () => {
    expect(await runMigrations(handle.db)).toEqual([]);
  });
});

describe('queue', () => {
  it('enqueues, claims and completes a job', async () => {
    const id = await enqueueJob(handle.db, 'task.interpret', { taskId: 't1' });
    expect(id).toBeTruthy();

    const claimed = await claimJobs(handle.db, 'worker-a', 5);
    expect(claimed.some((j) => j.id === id)).toBe(true);

    const job = claimed.find((j) => j.id === id)!;
    expect(job.kind).toBe('task.interpret');
    expect(job.payload).toEqual({ taskId: 't1' });
    expect(job.attempts).toBe(1);

    await completeJob(handle.db, job.id);
    const after = await claimJobs(handle.db, 'worker-a', 5);
    expect(after.some((j) => j.id === id)).toBe(false);
  });

  it('collapses duplicate enqueues with the same dedupe key', async () => {
    const first = await enqueueJob(handle.db, 'task.research', { taskId: 't2' }, { dedupeKey: 'research:t2' });
    const second = await enqueueJob(handle.db, 'task.research', { taskId: 't2' }, { dedupeKey: 'research:t2' });
    expect(first).toBeTruthy();
    // This is what stops a retried scheduler from queuing the same work twice.
    expect(second).toBeNull();
  });

  it('does not hand a claimed job to a second worker', async () => {
    await enqueueJob(handle.db, 'task.compare', { taskId: 't3' }, { dedupeKey: 'compare:t3' });
    const a = await claimJobs(handle.db, 'worker-a', 10);
    const b = await claimJobs(handle.db, 'worker-b', 10);
    const overlap = a.filter((x) => b.some((y) => y.id === x.id));
    expect(overlap).toHaveLength(0);
  });

  it('retries with backoff, then parks the job instead of looping forever', async () => {
    await enqueueJob(handle.db, 'task.collect', { taskId: 't4' }, { dedupeKey: 'collect:t4', maxAttempts: 2 });
    const [job] = await claimJobs(handle.db, 'worker-a', 1);

    expect(await failJob(handle.db, job!, new Error('boom'))).toBe('retrying');

    // Second failure reaches maxAttempts and parks it.
    await handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE id = ${job!.id}`);
    const [again] = await claimJobs(handle.db, 'worker-a', 1);
    expect(again?.attempts).toBe(2);
    expect(await failJob(handle.db, again!, new Error('boom again'))).toBe('dead');

    const depth = await queueDepth(handle.db);
    expect(depth.failed).toBeGreaterThanOrEqual(1);
  });

  it('reclaims a job whose worker died holding it', async () => {
    await enqueueJob(handle.db, 'task.poll_call', { callId: 'c1' }, { dedupeKey: 'poll:c1' });
    const [job] = await claimJobs(handle.db, 'worker-dead', 1);
    expect(job).toBeTruthy();

    // Simulate a worker that vanished ten minutes ago.
    await handle.db.execute(
      sql`UPDATE jobs SET locked_at = now() - interval '20 minutes' WHERE id = ${job!.id}`,
    );
    expect(await reclaimStaleJobs(handle.db, 600)).toBeGreaterThanOrEqual(1);

    const reclaimed = await claimJobs(handle.db, 'worker-b', 10);
    expect(reclaimed.some((j) => j.id === job!.id)).toBe(true);
  });
});

/**
 * A dedupe key reserves a slot while work is outstanding, not forever.
 *
 * The unique index covers every row regardless of state, so a completed job
 * used to hold its key permanently and the same work could never be queued
 * again. That stranded tasks: answering a question after the search had run
 * re-interpreted the task, the second `research:<taskId>` insert was silently
 * dropped, and the task sat in `interpreting` with nothing after "Understanding
 * request" in the progress list.
 */
describe('dedupe keys and finished jobs', () => {
  // The suite shares one database, so start from an empty queue: otherwise
  // `claimJobs` picks up whatever an earlier test left behind.
  beforeEach(async () => {
    await handle.db.execute(sql`DELETE FROM jobs`);
  });

  it('refuses a duplicate while the first is still outstanding', async () => {
    const first = await enqueueJob(handle.db, 'task.research', { taskId: 't1' }, { dedupeKey: 'research:t1' });
    const second = await enqueueJob(handle.db, 'task.research', { taskId: 't1' }, { dedupeKey: 'research:t1' });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it('allows the same work to be queued again once it has completed', async () => {
    await enqueueJob(handle.db, 'task.research', { taskId: 't2' }, { dedupeKey: 'research:t2' });
    const [claimed] = await claimJobs(handle.db, 'worker-1', 1);
    await completeJob(handle.db, claimed!.id);

    const again = await enqueueJob(handle.db, 'task.research', { taskId: 't2' }, { dedupeKey: 'research:t2' });
    expect(again).toBeTruthy();
  });

  it('allows it again once the job has died', async () => {
    // A job that exhausted its retries must not block a later, legitimate
    // attempt at the same work.
    await enqueueJob(
      handle.db,
      'task.research',
      { taskId: 't3' },
      { dedupeKey: 'research:t3', maxAttempts: 1 },
    );
    const [claimed] = await claimJobs(handle.db, 'worker-1', 1);
    const outcome = await failJob(handle.db, { ...claimed!, attempts: 5 }, new Error('boom'));
    expect(outcome).toBe('dead');

    const again = await enqueueJob(handle.db, 'task.research', { taskId: 't3' }, { dedupeKey: 'research:t3' });
    expect(again).toBeTruthy();
  });
});
