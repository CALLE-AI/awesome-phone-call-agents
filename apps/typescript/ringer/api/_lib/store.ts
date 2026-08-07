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

export type JobStatus = 'pending' | 'placed' | 'failed' | 'canceled'

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
}

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

const INDEX = 'ringer:jobs'
const jobKey = (id: string) => `ringer:job:${id}`

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

/** Create or replace a job and (re)index it by due time. */
export async function putJob(job: ScheduledJob): Promise<void> {
  await pipeline([
    ['SET', jobKey(job.id), JSON.stringify(job)],
    ['ZADD', INDEX, new Date(job.dueAt).getTime(), job.id],
  ])
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
