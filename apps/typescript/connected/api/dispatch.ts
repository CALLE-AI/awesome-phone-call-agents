import { CalleClient } from '@call-e/calle'
import { buildCallInput } from '../server/calle.js'
import { assertLiveAuthorized, idempotencyKey, parseCheckInRequest } from '../server/contract.js'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export default async function handler(request: Request): Promise<Response> {
  const expected = process.env.CONNECTED_DISPATCH_TOKEN
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) return json({ error: 'Unauthorized scheduler delivery.' }, 401)
  try {
    const body = await request.json() as { request?: unknown }
    const checkIn = parseCheckInRequest(body.request)
    assertLiveAuthorized(checkIn)
    const apiKey = process.env.CALLE_API_KEY
    if (!apiKey) throw new Error('CALL-E is not configured.')
    const client = new CalleClient({ apiKey, baseUrl: process.env.CALLE_BASE_URL || 'https://api.heycall-e.com' })
    const input = buildCallInput(checkIn)
    const call = await client.calls.create(input as never, { idempotencyKey: idempotencyKey(checkIn, input) })
    return json({ id: call.id, status: call.status }, 202)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Scheduled dispatch failed.' }, 400)
  }
}
