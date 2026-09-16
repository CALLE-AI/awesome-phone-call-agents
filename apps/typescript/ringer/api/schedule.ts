import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  allowCors,
  authorizeServerUse,
  header,
  scheduleJobId,
  sendError,
  serverCreds,
  type RawCreateBody,
} from './_lib/calle.js'
import {
  cancelJob,
  createJobIfAbsent,
  getJob,
  kvConfigured,
  listJobs,
  type ScheduledJob,
} from './_lib/store.js'

/**
 * /api/schedule — durable scheduled/recurring CALL-E calls.
 *
 *   POST   { dueAt, title, templateId, templateLabel, batch, escalated,
 *            body, recurrenceMonths? }  → create a job
 *   GET                                 → list jobs (soonest first)
 *   DELETE ?id=sched_xxx                → cancel a pending job
 *
 * Scheduling is an operator-enabled feature: the cron places the call later
 * using the server's CALL-E key, so both KV and CALLE_API_KEY must be set.
 * The `body` is the exact CALL-E create body the browser already built.
 */

const MAX_PENDING = 100
const MAX_HORIZON_MS = 400 * 24 * 60 * 60 * 1000 // ~13 months

export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (!kvConfigured()) {
    return sendError(res, 503, 'scheduling_unavailable', 'No scheduler backend configured (set KV_REST_API_URL / KV_REST_API_TOKEN).')
  }
  if (!serverCreds()) {
    return sendError(res, 503, 'scheduling_unavailable', 'Scheduled calls require a server CALL-E key (set CALLE_API_KEY).')
  }
  // Scheduling spends the operator's server key when it fires — gate it.
  if (!authorizeServerUse(req, res)) return

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ object: 'list', data: await listJobs() })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '')
      if (!id) return sendError(res, 400, 'invalid_request', 'A job `id` is required.')
      // Atomic w.r.t. the cron: if the call is being placed right now, refuse
      // rather than race a live dial. `missing` is treated as an idempotent no-op.
      const outcome = await cancelJob(id)
      if (outcome === 'busy') {
        return sendError(res, 409, 'job_dispatching', 'This call is being placed right now and can no longer be canceled.')
      }
      return res.status(200).json({ ok: true, outcome })
    }

    if (req.method === 'POST') {
      const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {}
      // A caller-supplied Idempotency-Key (or, absent one, the scheduling
      // content) gives the job a deterministic id, so a retried POST maps to the
      // same job rather than scheduling a duplicate call.
      const job = validate(body, header(req, 'idempotency-key'))
      if ('invalid' in job) return sendError(res, 400, 'invalid_request', job.invalid)

      // Idempotent replay: same key/content → return the existing job, no new one.
      const prior = await getJob(job.id)
      if (prior) return res.status(200).json(prior)

      const existing = await listJobs()
      if (existing.filter((j) => j.status === 'pending').length >= MAX_PENDING) {
        return sendError(res, 429, 'too_many_scheduled', `You already have ${MAX_PENDING} pending scheduled calls.`)
      }

      // Atomic create-if-absent closes the race between two concurrent retries.
      const { created, job: stored } = await createJobIfAbsent(job)
      return res.status(created ? 201 : 200).json(stored)
    }

    return sendError(res, 405, 'invalid_request', 'Use GET, POST, or DELETE.')
  } catch (err) {
    return sendError(res, 500, 'internal_error', (err as Error).message || 'Scheduler error.')
  }
}

type ValidationError = { invalid: string }

function validate(input: any, idempotencyKey: string): ScheduledJob | ValidationError {
  const body = input?.body as RawCreateBody | undefined
  if (!body || typeof body.task !== 'string' || !body.task.trim()) {
    return { invalid: 'A call `body` with a `task` string is required.' }
  }
  const dueMs = new Date(input?.dueAt).getTime()
  if (!Number.isFinite(dueMs)) return { invalid: 'A valid `dueAt` timestamp is required.' }
  if (dueMs - Date.now() > MAX_HORIZON_MS) {
    return { invalid: 'Scheduled time is too far in the future.' }
  }

  const recurrence = Number(input?.recurrenceMonths)
  const recurrenceMonths = Number.isFinite(recurrence) && recurrence > 0 ? recurrence : null
  const dueAt = new Date(dueMs).toISOString()
  return {
    id: scheduleJobId({ idempotencyKey, dueAt, recurrenceMonths, body }),
    createdAt: new Date().toISOString(),
    dueAt,
    status: 'pending',
    title: String(input?.title ?? 'Scheduled call').slice(0, 160),
    templateId: String(input?.templateId ?? 'custom'),
    templateLabel: String(input?.templateLabel ?? 'Call'),
    batch: Boolean(input?.batch),
    escalated: Boolean(input?.escalated),
    body,
    recurrenceMonths,
  }
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
