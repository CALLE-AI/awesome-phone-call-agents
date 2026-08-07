import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CalleAPIError } from '@call-e/calle'
import { createCalleCall, deriveWebhookUrl, serverCreds } from '../_lib/calle.js'
import {
  dueJobs,
  kvConfigured,
  putJob,
  updateJob,
  type ScheduledJob,
} from '../_lib/store.js'

/**
 * GET /api/cron/run-due — place every scheduled call whose time has come.
 *
 * Invoked by Vercel Cron (see vercel.json). When `CRON_SECRET` is set, Vercel
 * sends it as a Bearer token and we require it, so the endpoint can't be
 * triggered by strangers. Each due call is placed with the server key and the
 * job id as an idempotency key, so a double-run never double-dials.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Bad cron secret.' } })
  }

  if (!kvConfigured()) return res.status(200).json({ ok: true, note: 'no scheduler backend', fired: 0 })

  const creds = serverCreds()
  if (!creds) return res.status(200).json({ ok: true, note: 'no server CALL-E key', fired: 0 })

  const webhookUrl = deriveWebhookUrl(req.headers.host)
  const due = await dueJobs(Date.now())

  let fired = 0
  let failed = 0
  const results: Array<{ id: string; status: string; callId?: string; error?: string }> = []

  for (const job of due) {
    try {
      const withHook: ScheduledJob = webhookUrl
        ? { ...job, body: { ...job.body, webhook_url: job.body.webhook_url ?? webhookUrl } }
        : job
      const { id: callId } = await createCalleCall(creds, withHook.body, job.id)

      await updateJob({ ...job, status: 'placed', callId, placedAt: new Date().toISOString() })
      fired += 1
      results.push({ id: job.id, status: 'placed', callId })

      if (job.recurrenceMonths && job.recurrenceMonths > 0) {
        await putJob(nextOccurrence(job))
      }
    } catch (err) {
      const message = err instanceof CalleAPIError ? `${err.code}: ${err.message}` : (err as Error).message
      await updateJob({ ...job, status: 'failed', error: message })
      failed += 1
      results.push({ id: job.id, status: 'failed', error: message })
    }
  }

  return res.status(200).json({ ok: true, fired, failed, results })
}

/** Build the next job in a recurring series, `recurrenceMonths` after this one. */
function nextOccurrence(job: ScheduledJob): ScheduledJob {
  const next = new Date(job.dueAt)
  next.setMonth(next.getMonth() + (job.recurrenceMonths ?? 12))
  return {
    ...job,
    id: `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    dueAt: next.toISOString(),
    status: 'pending',
    callId: undefined,
    placedAt: undefined,
    error: undefined,
  }
}
