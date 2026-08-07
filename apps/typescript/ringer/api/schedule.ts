import type { VercelRequest, VercelResponse } from '@vercel/node'
import { allowCors, authorizeServerUse, sendError, serverCreds, type RawCreateBody } from './_lib/calle.js'
import {
  deleteJob,
  kvConfigured,
  listJobs,
  putJob,
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
      await deleteJob(id)
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST') {
      const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {}
      const job = validate(body)
      if ('invalid' in job) return sendError(res, 400, 'invalid_request', job.invalid)

      const existing = await listJobs()
      if (existing.filter((j) => j.status === 'pending').length >= MAX_PENDING) {
        return sendError(res, 429, 'too_many_scheduled', `You already have ${MAX_PENDING} pending scheduled calls.`)
      }

      await putJob(job)
      return res.status(201).json(job)
    }

    return sendError(res, 405, 'invalid_request', 'Use GET, POST, or DELETE.')
  } catch (err) {
    return sendError(res, 500, 'internal_error', (err as Error).message || 'Scheduler error.')
  }
}

type ValidationError = { invalid: string }

function validate(input: any): ScheduledJob | ValidationError {
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
  return {
    id: `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    dueAt: new Date(dueMs).toISOString(),
    status: 'pending',
    title: String(input?.title ?? 'Scheduled call').slice(0, 160),
    templateId: String(input?.templateId ?? 'custom'),
    templateLabel: String(input?.templateLabel ?? 'Call'),
    batch: Boolean(input?.batch),
    escalated: Boolean(input?.escalated),
    body,
    recurrenceMonths: Number.isFinite(recurrence) && recurrence > 0 ? recurrence : null,
  }
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
