import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CalleAPIError } from '@call-e/calle'
import { createCalleCall, deriveWebhookUrl, serverCreds } from '../_lib/calle.js'
import {
  acquireLock,
  dueJobs,
  getJob,
  kvConfigured,
  putJob,
  releaseLock,
  updateJob,
  type ScheduledJob,
} from '../_lib/store.js'

/** After this many attempts an ambiguous job is given up on as `failed`. */
const MAX_ATTEMPTS = 5

/**
 * GET /api/cron/run-due — place every scheduled call whose time has come.
 *
 * Invoked by Vercel Cron (see vercel.json). Because it dials with the operator's
 * server key, the endpoint must never be publicly triggerable: whenever the
 * scheduler is *armed* (KV + a server key) we REQUIRE `CRON_SECRET` and a
 * matching Bearer token (Vercel Cron sends it) and fail closed if it is unset.
 *
 * Each due job is claimed under an atomic lock (so a concurrent cancel can't be
 * dialed) and placed with the job id as its idempotency key, so a double run —
 * or a retry after an ambiguous failure — never double-dials.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const armed = kvConfigured() && Boolean(serverCreds())

  // Fail closed: the server-key dialer is never reachable without the secret.
  if (armed) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return res
        .status(500)
        .json({ error: { code: 'cron_secret_required', message: 'Set CRON_SECRET to run the scheduler cron.' } })
    }
    if (req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Bad cron secret.' } })
    }
  }

  if (!kvConfigured()) return res.status(200).json({ ok: true, note: 'no scheduler backend', fired: 0 })

  const creds = serverCreds()
  if (!creds) return res.status(200).json({ ok: true, note: 'no server CALL-E key', fired: 0 })

  const webhookUrl = deriveWebhookUrl(req.headers.host)
  const due = await dueJobs(Date.now())

  let fired = 0
  let failed = 0
  let retried = 0
  let skipped = 0
  const results: Array<{ id: string; status: string; callId?: string; error?: string }> = []

  for (const claimed of due) {
    // Claim the job so a concurrent cancel/dispatch can't act on it too.
    if (!(await acquireLock(claimed.id))) {
      skipped += 1
      continue
    }
    try {
      // Re-read inside the lock: it may have been canceled or already placed
      // between listing the due jobs and claiming this one.
      const job = await getJob(claimed.id)
      if (!job || job.status !== 'pending') {
        skipped += 1
        continue
      }

      const attempts = (job.attempts ?? 0) + 1
      try {
        const body = webhookUrl
          ? { ...job.body, webhook_url: job.body.webhook_url ?? webhookUrl }
          : job.body
        const { id: callId } = await createCalleCall(creds, body, job.id)

        await updateJob({ ...job, status: 'placed', callId, placedAt: new Date().toISOString(), attempts })
        fired += 1
        results.push({ id: job.id, status: 'placed', callId })

        if (job.recurrenceMonths && job.recurrenceMonths > 0) {
          await putJob(nextOccurrence(job))
        }
      } catch (err) {
        const message = err instanceof CalleAPIError ? `${err.code}: ${err.message}` : (err as Error).message

        // Only a *definitive* client rejection (a 4xx that won't change on
        // retry) is a real `failed`. Network errors, timeouts, 5xx, and
        // throttling are ambiguous — the provider may have accepted the call —
        // so we leave the job `pending` to retry under the SAME idempotency key
        // (job.id): the provider dedups, so a retry can never double-dial.
        if (isDefinitive(err) || attempts >= MAX_ATTEMPTS) {
          await updateJob({ ...job, status: 'failed', error: message, attempts })
          failed += 1
          results.push({ id: job.id, status: 'failed', error: message })
        } else {
          await updateJob({ ...job, status: 'pending', error: message, attempts })
          retried += 1
          results.push({ id: job.id, status: 'retry', error: message })
        }
      }
    } finally {
      await releaseLock(claimed.id)
    }
  }

  return res.status(200).json({ ok: true, fired, failed, retried, skipped, results })
}

/**
 * A definitive failure is a client error the provider will reject the same way
 * on every retry (bad request, unauthorized, …) — NOT a transient 408/425/429
 * or any 5xx/network error, which may have already placed the call.
 */
function isDefinitive(err: unknown): boolean {
  if (!(err instanceof CalleAPIError)) return false // network/timeout → ambiguous
  const status = err.status
  if (typeof status !== 'number') return false
  if (status === 408 || status === 425 || status === 429) return false
  return status >= 400 && status < 500
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
    attempts: undefined,
  }
}
