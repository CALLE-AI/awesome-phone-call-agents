import type { VercelRequest, VercelResponse } from '@vercel/node'
import { allowCors, proxyGet, requireKey, sendError } from './_lib/calle.js'

/**
 * GET /api/call-events?id=call_123&cursor=&limit= — developer event timeline.
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

  const params = new URLSearchParams()
  if (req.query.cursor) params.set('cursor', String(req.query.cursor))
  if (req.query.limit) params.set('limit', String(req.query.limit))
  const qs = params.toString()

  await proxyGet(
    res,
    creds.baseUrl,
    creds.apiKey,
    `/v1/calls/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`,
  )
}
