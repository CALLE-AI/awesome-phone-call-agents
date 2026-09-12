import { sql } from 'drizzle-orm';
import { logger, incrementCounter } from '@dial/observability';
import type { Db } from './client.js';
import type { JobRow } from './schema.js';

/**
 * Durable job queue on Postgres, claimed with FOR UPDATE SKIP LOCKED.
 *
 * Why not Redis/BullMQ by default: Dial already requires Postgres, and phone
 * work must survive a process restart. Putting the queue in the same database
 * as the tasks means claiming a job and recording its effect happen against one
 * system, so a crash between "job taken" and "call recorded" cannot leave the
 * two disagreeing. A Redis driver is used instead when REDIS_URL is set.
 *
 * Delivery is at-least-once. That is safe here only because the thing a job
 * ultimately does -- dispatching a call -- is guarded by a unique idempotency
 * key in the `calls` table. Redelivery cannot dial twice.
 */

export type JobKind =
  | 'task.interpret'
  | 'task.research'
  | 'task.plan_calls'
  | 'task.dispatch_wave'
  | 'task.poll_call'
  | 'task.collect'
  | 'task.compare'
  | 'task.timeout'
  | 'push.deliver'
  | 'biz.dispatch_run'
  | 'biz.poll_recipient';

export interface EnqueueOptions {
  runAt?: Date;
  /** Repeated enqueues with the same key collapse into one row. */
  dedupeKey?: string;
  maxAttempts?: number;
}

export interface QueuedJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

function newId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueJob(
  db: Db,
  kind: JobKind,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const id = newId();
  const runAt = options.runAt ?? new Date();
  const dedupeKey = options.dedupeKey ?? null;
  const maxAttempts = options.maxAttempts ?? 5;

  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO jobs (id, kind, payload, state, run_at, max_attempts, dedupe_key)
    VALUES (${id}, ${kind}, ${JSON.stringify(payload)}::jsonb, 'pending',
            ${runAt.toISOString()}, ${maxAttempts}, ${dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `);

  const inserted = (result.rows ?? [])[0]?.id ?? null;
  if (inserted) incrementCounter('queue.enqueued', { kind });
  return inserted;
}

/**
 * Atomically claims up to `limit` due jobs. SKIP LOCKED means two workers never
 * take the same row, and a worker that dies mid-job releases its lock with the
 * transaction, so the job is retried rather than lost.
 */
export async function claimJobs(db: Db, workerId: string, limit = 1): Promise<QueuedJob[]> {
  const result = await db.execute<JobRow>(sql`
    WITH claimed AS (
      SELECT id FROM jobs
      WHERE state = 'pending' AND run_at <= now()
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE jobs
    SET state = 'running',
        attempts = attempts + 1,
        locked_at = now(),
        locked_by = ${workerId}
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  `);

  return (result.rows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as JobKind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts ?? (row as unknown as { max_attempts: number }).max_attempts ?? 5,
  }));
}

/**
 * Marks a job done and releases its dedupe slot.
 *
 * Releasing matters as much as the state change. A dedupe key means "do not
 * queue this twice while one is outstanding", but the unique index covers every
 * row regardless of state, so a completed job held its key forever and the same
 * work could never be queued again.
 *
 * That stranded tasks. Answering a question after the search had run
 * re-interpreted the task, which tried to enqueue `research:<taskId>` a second
 * time; the insert was silently dropped, no job ever ran, and the task sat in
 * `interpreting` with the progress list reading "Understanding request" and
 * nothing after it.
 */
export async function completeJob(db: Db, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET state = 'completed', completed_at = now(), locked_by = NULL, dedupe_key = NULL
    WHERE id = ${id}
  `);
  incrementCounter('queue.completed');
}

/**
 * Records a failure. Retries back off exponentially; once attempts reach
 * maxAttempts the job is parked as 'failed' rather than looping forever --
 * section 27's retry ceiling, which also stops a broken extraction from
 * redialling the same business repeatedly.
 */
export async function failJob(db: Db, job: QueuedJob, error: unknown): Promise<'retrying' | 'dead'> {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.maxAttempts;

  if (dead) {
    await db.execute(sql`
      UPDATE jobs
      SET state = 'failed',
          last_error = ${message.slice(0, 2000)},
          locked_by = NULL,
          -- Same reason as completion: a dead job must not hold the slot
          -- against a later, legitimate attempt at the same work.
          dedupe_key = NULL
      WHERE id = ${job.id}
    `);
    incrementCounter('queue.dead', { kind: job.kind });
    logger.error('job exhausted retries', { jobId: job.id, kind: job.kind, error: message });
    return 'dead';
  }

  const delaySeconds = Math.min(300, 2 ** job.attempts * 5);
  await db.execute(sql`
    UPDATE jobs
    SET state = 'pending',
        run_at = now() + (${delaySeconds} * interval '1 second'),
        last_error = ${message.slice(0, 2000)},
        locked_by = NULL
        -- The dedupe key is deliberately kept while a retry is outstanding:
        -- "do not queue this twice while one is in flight" must survive a
        -- failure, or an API-triggered enqueue and the scheduled retry could
        -- both run the same stage at once. It is released on completion and
        -- on death below.
    WHERE id = ${job.id}
  `);
  incrementCounter('queue.retried', { kind: job.kind });
  logger.warn('job failed, will retry', {
    jobId: job.id,
    kind: job.kind,
    attempt: job.attempts,
    delaySeconds,
    error: message,
  });
  return 'retrying';
}

/** Releases jobs whose worker died holding them. */
export async function reclaimStaleJobs(db: Db, olderThanSeconds = 600): Promise<number> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET state = 'pending', locked_by = NULL, dedupe_key = NULL
    WHERE state = 'running'
      AND locked_at < now() - (${olderThanSeconds} * interval '1 second')
    RETURNING id
  `);
  const count = (result.rows ?? []).length;
  if (count) logger.warn('reclaimed stale jobs', { count });
  return count;
}

export async function queueDepth(db: Db): Promise<{ pending: number; running: number; failed: number }> {
  const result = await db.execute<{ state: string; count: string }>(
    sql`SELECT state, count(*)::text AS count FROM jobs GROUP BY state`,
  );
  const out = { pending: 0, running: 0, failed: 0 };
  for (const row of result.rows ?? []) {
    if (row.state === 'pending') out.pending = Number(row.count);
    if (row.state === 'running') out.running = Number(row.count);
    if (row.state === 'failed') out.failed = Number(row.count);
  }
  return out;
}
