import type { CreateCallBody } from './calle/types'

/**
 * Client mirror of the server scheduler (`/api/schedule`, `api/_lib/store.ts`).
 *
 * Durable, server-fired scheduled calls: unlike the in-browser reminders in
 * `followups.ts`, these are placed by a cron even when the tab is closed. They
 * are only available when the deployment configured a server key + KV
 * (reported by `/api/health` as `hasScheduler`); otherwise the UI falls back to
 * local reminders.
 */

export type JobStatus = 'pending' | 'placed' | 'failed' | 'canceled'

export interface ScheduledJob {
  id: string
  createdAt: string
  dueAt: string
  status: JobStatus
  title: string
  templateId: string
  templateLabel: string
  batch: boolean
  escalated: boolean
  recurrenceMonths?: number | null
  callId?: string
  placedAt?: string
  error?: string
}

export interface CreateJobInput {
  dueAt: Date
  title: string
  templateId: string
  templateLabel: string
  batch: boolean
  escalated: boolean
  body: CreateCallBody
  recurrenceMonths?: number | null
}

async function parse(res: Response): Promise<any> {
  const text = await res.text()
  const json = text ? safeJson(text) : {}
  if (!res.ok) {
    const err = (json?.error ?? {}) as { message?: string; code?: string }
    throw new Error(err.message || `Scheduler request failed (${res.status}).`)
  }
  return json
}

/** The scheduler spends the shared server key, so requests carry the app secret. */
function authHeaders(appSecret?: string): Record<string, string> {
  return appSecret ? { 'x-ringer-app-secret': appSecret } : {}
}

export async function createJob(input: CreateJobInput, appSecret?: string): Promise<ScheduledJob> {
  return parse(
    await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(appSecret) },
      body: JSON.stringify({ ...input, dueAt: input.dueAt.toISOString() }),
    }),
  )
}

export async function listJobs(appSecret?: string): Promise<ScheduledJob[]> {
  const json = await parse(await fetch('/api/schedule', { headers: authHeaders(appSecret) }))
  return Array.isArray(json?.data) ? (json.data as ScheduledJob[]) : []
}

export async function cancelJob(id: string, appSecret?: string): Promise<void> {
  await parse(
    await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(appSecret),
    }),
  )
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
