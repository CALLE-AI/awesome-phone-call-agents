import type { RawCreateBody } from './calle.js'

/**
 * Durable store for scheduled calls, backed by Vercel KV / Upstash Redis over
 * its REST API (no SDK dependency — we speak the REST protocol with `fetch`).
 *
 * Why a server store at all: the whole point of a *scheduled* call is that it
 * fires while the user's browser is closed. That requires (a) durable state a
 * cron can read and (b) an operator-configured CALL-E key to place the call.
 * When KV is not configured the app degrades to in-browser reminders.
 *
 * Data model:
 *   ringer:job:<id>  → JSON-encoded ScheduledJob
 *   ringer:jobs      → sorted set of job ids scored by dueAt (epoch ms)
 * The cron reads due ids with ZRANGEBYSCORE; the drawer lists all with ZRANGE.
 */

export type JobStatus = 'pending' | 'placed' | 'failed' | 'canceled' | 'unresolved'

export interface ScheduledJob {
  id: string
  createdAt: string
  /** ISO timestamp at/after which the call should be placed. */
  dueAt: string
  status: JobStatus
  title: string
  templateId: string
  templateLabel: string
  batch: boolean
  escalated: boolean
  /** The exact CALL-E create body to POST when due. */
  body: RawCreateBody
  /** When set, a follow-up job is queued this many months later after firing. */
  recurrenceMonths?: number | null
  /** Set once the call is placed. */
  callId?: string
  placedAt?: string
  error?: string
  /** Dispatch attempts so far — bounds retries after ambiguous failures. */
  attempts?: number
}

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

const INDEX = 'ringer:jobs'
const jobKey = (id: string) => `ringer:job:${id}`
const lockKey = (id: string) => `ringer:lock:${id}`

/** How long a single dispatch/cancel critical section may hold a job's lock. */
export const LOCK_TTL_SEC = 120

export function kvConfigured(): boolean {
  return Boolean(KV_URL && KV_TOKEN)
}

type Command = (string | number)[]

async function redis<T = unknown>(command: Command): Promise<T> {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  const json = (await r.json()) as { result?: T; error?: string }
  if (json.error) throw new Error(`KV error: ${json.error}`)
  return json.result as T
}

async function pipeline(commands: Command[]): Promise<void> {
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  const json = (await r.json()) as Array<{ result?: unknown; error?: string }>
  for (const item of json) {
    if (item?.error) throw new Error(`KV error: ${item.error}`)
  }
}

function parseJob(raw: string | null): ScheduledJob | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ScheduledJob
  } catch {
    return null
  }
}

async function jobsByIds(ids: string[]): Promise<ScheduledJob[]> {
  if (ids.length === 0) return []
  const raws = await redis<(string | null)[]>(['MGET', ...ids.map(jobKey)])
  return raws.map(parseJob).filter((j): j is ScheduledJob => j !== null)
}

/**
 * Create a job only if one with this id doesn't already exist, and index it —
 * in ONE atomic step. A retried scheduling POST that resolves to the same
 * content/request key thus reuses the existing job instead of scheduling (and
 * later dialing) a duplicate. Doing the `SET NX` and the `ZADD` inside a single
 * Lua script means two racing retries can't both create, and a crash can't leave
 * a job that exists but is unindexed (and so would never fire).
 * Returns whether a new job was created plus the authoritative stored job.
 */
const CREATE_IF_ABSENT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX') then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
  return 1
else
  return 0
end`

export async function createJobIfAbsent(
  job: ScheduledJob,
): Promise<{ created: boolean; job: ScheduledJob }> {
  const created = await redis<number>([
    'EVAL',
    CREATE_IF_ABSENT,
    2,
    jobKey(job.id),
    INDEX,
    JSON.stringify(job),
    new Date(job.dueAt).getTime(),
    job.id,
  ])
  if (created === 1) return { created: true, job }
  return { created: false, job: (await getJob(job.id)) ?? job }
}

/** Update a job record in place (does not touch the due-time index). */
export async function updateJob(job: ScheduledJob): Promise<void> {
  await redis(['SET', jobKey(job.id), JSON.stringify(job)])
}

export async function getJob(id: string): Promise<ScheduledJob | null> {
  return parseJob(await redis<string | null>(['GET', jobKey(id)]))
}

export async function deleteJob(id: string): Promise<void> {
  await pipeline([
    ['DEL', jobKey(id)],
    ['ZREM', INDEX, id],
  ])
}

/** All jobs, soonest-due first (includes placed/failed for history). */
export async function listJobs(): Promise<ScheduledJob[]> {
  const ids = await redis<string[]>(['ZRANGE', INDEX, 0, -1])
  const jobs = await jobsByIds(ids)
  return jobs.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

/** Pending jobs whose due time has passed — the cron's work queue. */
export async function dueJobs(nowMs: number): Promise<ScheduledJob[]> {
  const ids = await redis<string[]>(['ZRANGEBYSCORE', INDEX, 0, nowMs])
  const jobs = await jobsByIds(ids)
  return jobs.filter((j) => j.status === 'pending')
}

/**
 * Atomic per-job mutex used to serialize dispatch and cancellation.
 *
 * `SET … NX` is atomic in Redis, so only one of {cron dispatch, user cancel}
 * can hold a given job's lock at a time. The holder then re-reads the job's
 * status inside the lock and acts on a consistent view — closing the race where
 * the cron read a `pending` job just before a `DELETE` and dialed it anyway.
 * A short TTL guarantees the lock can't wedge a job if a worker dies mid-flight.
 */
export async function acquireLock(id: string, ttlSec = LOCK_TTL_SEC): Promise<boolean> {
  const r = await redis<string | null>(['SET', lockKey(id), '1', 'NX', 'EX', ttlSec])
  return r === 'OK'
}

export async function releaseLock(id: string): Promise<void> {
  await redis(['DEL', lockKey(id)])
}

/**
 * Cancel a scheduled job atomically with respect to the dispatcher.
 *
 *  - `'busy'`     — the cron holds the lock (the call is being placed right
 *                   now); cancellation is refused so we never race a live dial.
 *  - `'missing'`  — no such (still-schedulable) job; cancel is a no-op.
 *  - `'canceled'` — removed from the schedulable index and deleted.
 */
export async function cancelJob(id: string): Promise<'busy' | 'missing' | 'canceled'> {
  if (!(await acquireLock(id))) return 'busy'
  try {
    const job = await getJob(id)
    if (!job) return 'missing'
    await deleteJob(id)
    return 'canceled'
  } finally {
    await releaseLock(id)
  }
}
