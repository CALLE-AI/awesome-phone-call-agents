import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CalleAPIError } from '@call-e/calle'
import {
  allowCors,
  contentIdempotencyKey,
  createCalleCall,
  deriveWebhookUrl,
  header,
  requireKey,
  sendError,
} from './_lib/calle.js'

/**
 * POST /api/calls — create a CALL-E call task.
 *
 * Uses the shared `createCalleCall` helper (official `@call-e/calle` server
 * SDK) so the API key never reaches the browser. Accepts the raw (snake_case)
 * create body from the client. Returns `{ id }`; the client then polls
 * /api/call and /api/call-events for the live timeline.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return sendError(res, 405, 'invalid_request', 'Use POST.')

  const creds = requireKey(req, res)
  if (!creds) return

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {}
  if (!body.task || typeof body.task !== 'string') {
    return sendError(res, 400, 'invalid_request', 'A `task` string is required.')
  }

  // Idempotency is bound to the call's content (not a random workflow id), so a
  // changed phone/task/schema can never replay under a prior call's key.
  const idempotencyKey = header(req, 'idempotency-key') || contentIdempotencyKey(body)

  try {
    const call = await createCalleCall(
      creds,
      {
        task: body.task,
        recipients: body.recipients,
        result_schema: body.result_schema ?? undefined,
        recipient_result_schema: body.recipient_result_schema ?? undefined,
        metadata: body.metadata,
        webhook_url: body.webhook_url ?? deriveWebhookUrl(),
      },
      idempotencyKey,
    )
    return res.status(201).json({ id: call.id })
  } catch (err) {
    if (err instanceof CalleAPIError) {
      return sendError(res, err.status || 400, err.code, err.message, err.details)
    }
    return sendError(res, 500, 'internal_error', (err as Error).message || 'Create call failed.')
  }
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
