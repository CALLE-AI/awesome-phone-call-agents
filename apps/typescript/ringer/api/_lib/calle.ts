import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'node:crypto'
import { CalleClient } from '@call-e/calle'

const OFFICIAL_BASE = 'https://api.heycall-e.com'

/**
 * Content-bound idempotency key: derived from the fields that decide *who* is
 * called and *what* is asked. An identical retry dedups; editing the phone,
 * task, or schema yields a new key, so a changed request can never alias an
 * earlier call under the same key.
 */
export function contentIdempotencyKey(body: RawCreateBody): string {
  const canonical = JSON.stringify({
    task: body.task ?? '',
    recipients: body.recipients ?? [],
    result_schema: body.result_schema ?? null,
    recipient_result_schema: body.recipient_result_schema ?? null,
  })
  return 'ringer_' + createHash('sha256').update(canonical).digest('hex').slice(0, 40)
}

/**
 * Deterministic id for a *scheduled* job, so a retried POST maps to the SAME
 * job instead of minting a fresh random id (which would schedule — and later
 * dial — a duplicate call). Prefers a caller-supplied idempotency key; otherwise
 * derives from the scheduling content, keyed by `dueAt` so distinct occurrences
 * of a recurring series stay distinct while a replay of one occurrence dedups.
 * The cron then uses this stable id as the provider idempotency key.
 */
export function scheduleJobId(input: {
  idempotencyKey?: string
  dueAt: string
  recurrenceMonths?: number | null
  body: RawCreateBody
}): string {
  const key = input.idempotencyKey?.trim()
  const basis = key
    ? `key:${key}`
    : 'content:' +
      JSON.stringify({
        dueAt: input.dueAt,
        recurrenceMonths: input.recurrenceMonths ?? null,
        task: input.body.task ?? '',
        recipients: input.body.recipients ?? [],
        result_schema: input.body.result_schema ?? null,
        recipient_result_schema: input.body.recipient_result_schema ?? null,
      })
  return 'sched_' + createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

/**
 * A caller-supplied base URL is trusted only for the official host (or a local
 * test origin). This prevents a request from pointing the API key at an
 * arbitrary host. The operator's own `CALLE_BASE_URL` env is always trusted.
 */
export function isAllowedBaseUrl(u: string): boolean {
  try {
    const url = new URL(u)
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1') return true
    return url.protocol === 'https:' && (host === 'api.heycall-e.com' || host.endsWith('.heycall-e.com'))
  } catch {
    return false
  }
}

/** Raw (snake_case) create-call body as sent by the browser / stored in a job. */
export interface RawCreateBody {
  task: string
  recipients?: Array<{ phones?: string[]; phone?: string; region?: string; locale?: string }>
  result_schema?: Record<string, unknown> | null
  recipient_result_schema?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  webhook_url?: string
}

/**
 * Place a CALL-E call via the official SDK. Shared by the interactive
 * `/api/calls` endpoint and the scheduled-call cron so both use one code
 * path and one snake_case→camelCase mapping. Throws `CalleAPIError` (has
 * `status`/`code`) on API errors so callers can map or record them.
 */
export async function createCalleCall(
  creds: { apiKey: string; baseUrl: string },
  body: RawCreateBody,
  idempotencyKey?: string,
): Promise<{ id: string }> {
  const client = new CalleClient({ apiKey: creds.apiKey, baseUrl: creds.baseUrl })
  const call = await client.calls.create(
    {
      task: body.task,
      recipients: body.recipients,
      resultSchema: body.result_schema ?? undefined,
      recipientResultSchema: body.recipient_result_schema ?? undefined,
      metadata: body.metadata,
      webhookUrl: body.webhook_url,
    },
    idempotencyKey ? { idempotencyKey } : undefined,
  )
  return { id: call.id }
}

/** Return the explicitly configured current unsigned-webhook URL. */
export function deriveWebhookUrl(): string | undefined {
  return process.env.CALLE_WEBHOOK_URL?.trim() || undefined
}

/**
 * Credentials for server-initiated calls (the scheduler). Unlike interactive
 * calls, a cron run has no BYOK header, so scheduled calls require the
 * operator's `CALLE_API_KEY`. Returns null when none is configured.
 */
export function serverCreds(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.CALLE_API_KEY || ''
  if (!apiKey) return null
  const baseUrl = (process.env.CALLE_BASE_URL || 'https://api.heycall-e.com').replace(/\/$/, '')
  return { apiKey, baseUrl }
}

/** Resolve the CALL-E credentials for a request (BYOK header or server env). */
export function resolveCreds(req: VercelRequest): { apiKey: string; baseUrl: string } {
  const headerKey = header(req, 'x-calle-key')
  const headerBase = header(req, 'x-calle-base-url')
  const apiKey = headerKey || process.env.CALLE_API_KEY || ''
  let baseUrl = (process.env.CALLE_BASE_URL || OFFICIAL_BASE).replace(/\/$/, '')
  // Honor a caller-supplied base URL ONLY when the caller also brought their own
  // key (BYOK) and the host is allowlisted — never redirect the operator's
  // server key to a client-chosen host.
  if (headerBase && headerKey && isAllowedBaseUrl(headerBase)) {
    baseUrl = headerBase.replace(/\/$/, '')
  }
  return { apiKey, baseUrl }
}

export function header(req: VercelRequest, name: string): string {
  const v = req.headers[name]
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

export function sendError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  res.status(status).json({ error: { code, message, details } })
}

/**
 * Authorize a request that would spend the operator's SERVER key. BYOK requests
 * spend the caller's own key and need no gate; but the shared server key must
 * not be spendable by strangers. We fail closed: if a server key is configured
 * without a `CALLE_APP_SECRET`, the shared key is locked (use BYOK instead).
 * Returns true when authorized; otherwise sends an error and returns false.
 */
export function authorizeServerUse(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.CALLE_APP_SECRET
  if (!secret) {
    sendError(
      res,
      403,
      'app_secret_required',
      'This deployment’s shared CALL-E key is locked. Set CALLE_APP_SECRET on the server, or use your own key (BYOK) in Settings.',
    )
    return false
  }
  if (header(req, 'x-ringer-app-secret') !== secret) {
    sendError(
      res,
      401,
      'app_secret_required',
      'Enter this deployment’s access secret in Settings to use its shared CALL-E key.',
    )
    return false
  }
  return true
}

export function requireKey(
  req: VercelRequest,
  res: VercelResponse,
): { apiKey: string; baseUrl: string } | null {
  const usingServerKey = !header(req, 'x-calle-key')
  const creds = resolveCreds(req)
  if (!creds.apiKey) {
    sendError(
      res,
      401,
      'unauthorized',
      'No CALL-E API key. Add your key in Settings (BYOK) or set CALLE_API_KEY on the server.',
    )
    return null
  }
  // Spending the operator's server key requires the app secret; BYOK does not.
  if (usingServerKey && !authorizeServerUse(req, res)) return null
  return creds
}

/** Proxy a GET to the CALL-E REST API, forwarding the raw JSON body through. */
export async function proxyGet(
  res: VercelResponse,
  baseUrl: string,
  apiKey: string,
  path: string,
) {
  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    sendError(res, 502, 'provider_unavailable', 'Could not reach the CALL-E API.')
    return
  }
  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('Content-Type', 'application/json')
  res.send(text || '{}')
}

export function allowCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-calle-key,x-calle-base-url,x-ringer-app-secret,idempotency-key')
}
