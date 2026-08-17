import type { VercelRequest, VercelResponse } from '@vercel/node'
import { allowCors, proxyGet, requireKey, sendError } from './_lib/calle.js'

/**
 * GET /api/call?id=call_123 — fetch current call state.
 * Proxies the raw CALL-E REST response so the client receives the exact
 * snake_case object model it renders (identical to Demo Mode output).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return sendError(res, 405, 'invalid_request', 'Use GET.')

  const id = String(req.query.id ?? '')
  if (!id.startsWith('call_')) {
    return sendError(res, 400, 'invalid_request', 'A valid call `id` is required.')
  }

  const creds = requireKey(req, res)
  if (!creds) return

  await proxyGet(res, creds.baseUrl, creds.apiKey, `/v1/calls/${encodeURIComponent(id)}`)
}
