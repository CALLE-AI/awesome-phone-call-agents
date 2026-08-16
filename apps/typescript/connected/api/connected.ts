import { CalleClient, type Call } from '@call-e/calle'
import { buildCallInput } from '../server/calle.js'
import { assertLiveAuthorized, idempotencyKey, parseCheckInRequest, parseCheckInResult, type CheckInResult } from '../server/contract.js'
import { decidePostCall } from '../server/decision.js'
import { scheduleNextCall } from '../server/scheduler.js'

const TERMINAL = new Set(['completed', 'failed', 'canceled', 'cancelled', 'no_answer', 'declined', 'voicemail', 'busy', 'expired'])

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function configured() {
  return {
    provider: Boolean(process.env.CALLE_API_KEY),
    accessProtection: Boolean(process.env.CONNECTED_ACCESS_TOKEN),
    automaticCadence: Boolean(process.env.QSTASH_TOKEN && process.env.CONNECTED_DISPATCH_TOKEN && process.env.CONNECTED_PUBLIC_URL),
  }
}

function authorize(request: Request): boolean {
  const expected = process.env.CONNECTED_ACCESS_TOKEN
  return Boolean(expected) && request.headers.get('x-connected-access-token') === expected
}

function client(): CalleClient {
  const apiKey = process.env.CALLE_API_KEY
  if (!apiKey) throw new Error('CALL-E is not configured on this deployment.')
  return new CalleClient({ apiKey, baseUrl: process.env.CALLE_BASE_URL || 'https://api.heycall-e.com' })
}

function offeredEventIds(call: Call): string[] {
  const value = call.metadata.offered_event_ids
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function resultFrom(call: Call): CheckInResult | null {
  const value = call.recipients[0]?.structuredResult ?? call.structuredResult
  return value ? parseCheckInResult(value) : null
}

async function publicCall(call: Call) {
  const result = resultFrom(call)
  const status = String(call.status).toLowerCase()
  const plan = result ? decidePostCall(offeredEventIds(call), result) : null
  const continuation = call.metadata.continuation_request
  const schedule = plan?.nextCallAt && continuation
    ? await scheduleNextCall(call.id, parseCheckInRequest(continuation), plan.nextCallAt)
    : null
  return {
    id: call.id,
    status,
    terminal: TERMINAL.has(status),
    taskCompleted: call.taskCompleted,
    summary: call.summary,
    completedAt: call.completedAt,
    result,
    plan,
    schedule,
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  const url = new URL(request.url)

  if (request.method === 'GET' && !url.searchParams.has('callId')) {
    const state = configured()
    return json({ liveReady: state.provider && state.accessProtection, ...state })
  }

  if (!authorize(request)) return json({ error: 'Operator access is required.' }, 401)

  try {
    if (request.method === 'POST') {
      const body = await request.json() as { request?: unknown }
      const checkIn = parseCheckInRequest(body.request)
      assertLiveAuthorized(checkIn)
      const input = buildCallInput(checkIn)
      const call = await client().calls.create(input as never, { idempotencyKey: idempotencyKey(checkIn, input) })
      return json(await publicCall(call), 202)
    }

    if (request.method === 'GET') {
      const callId = url.searchParams.get('callId') ?? ''
      if (!/^call_[A-Za-z0-9_-]+$/.test(callId)) return json({ error: 'A valid CALL-E call id is required.' }, 400)
      return json(await publicCall(await client().calls.get(callId)))
    }

    return json({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected workflow error.'
    const status = /not configured/i.test(message) ? 503 : /must|required|invalid|unknown/i.test(message) ? 400 : 502
    return json({ error: message }, status)
  }
}
