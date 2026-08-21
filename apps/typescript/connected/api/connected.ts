import { CalleClient, type Call } from '@call-e/calle'
import { bindCompletedCall, buildCallInput, OFFICIAL_CALLE_ORIGIN } from '../server/calle.js'
import { assertLiveAuthorized, idempotencyKey, parseCheckInRequest } from '../server/contract.js'
import { decidePostCall } from '../server/decision.js'
import { cancelCadence, scheduleNextCall, type CancellationReceipt, type ScheduleReceipt } from '../server/scheduler.js'

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
  return new CalleClient({ apiKey, baseUrl: OFFICIAL_CALLE_ORIGIN })
}

type CadencePort = {
  cancel(participantId: string): Promise<CancellationReceipt>
  schedule(sourceCallId: string, request: ReturnType<typeof parseCheckInRequest>, nextCallAt: string): Promise<ScheduleReceipt>
}

const cadencePort: CadencePort = { cancel: cancelCadence, schedule: scheduleNextCall }

export async function projectCall(call: Call, expectedCallId: string, cadence: CadencePort = cadencePort) {
  const status = String(call.status).toLowerCase()
  if (status !== 'completed') return {
    id: call.id, status, terminal: TERMINAL.has(status), taskCompleted: call.taskCompleted,
    summary: call.summary, completedAt: call.completedAt, result: null, plan: null, schedule: null, cancellation: null,
  }
  const bound = bindCompletedCall(call, expectedCallId)
  const plan = decidePostCall(bound.offeredEventIds, bound.result)
  const cancellation = plan.suppressFutureCalls ? await cadence.cancel(bound.request.participantId) : null
  const schedule = plan.nextCallAt && !plan.suppressFutureCalls
    ? await cadence.schedule(call.id, bound.request, plan.nextCallAt)
    : null
  return {
    id: call.id,
    status,
    terminal: TERMINAL.has(status),
    taskCompleted: call.taskCompleted,
    summary: call.summary,
    completedAt: call.completedAt,
    result: bound.result,
    plan,
    schedule,
    cancellation,
  }
}

async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  const url = new URL(request.url, 'https://connected.invalid')

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
      return json(await projectCall(call, call.id), 202)
    }

    if (request.method === 'GET') {
      const callId = url.searchParams.get('callId') ?? ''
      if (!/^call_[A-Za-z0-9_-]+$/.test(callId)) return json({ error: 'A valid CALL-E call id is required.' }, 400)
      return json(await projectCall(await client().calls.get(callId), callId))
    }

    if (request.method === 'DELETE') {
      const body = await request.json() as { participantId?: unknown }
      if (typeof body.participantId !== 'string' || !body.participantId.trim()) return json({ error: 'participantId is required.' }, 400)
      return json(await cancelCadence(body.participantId))
    }

    return json({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected workflow error.'
    const status = /not configured/i.test(message) ? 503 : /must|required|invalid|unknown/i.test(message) ? 400 : 502
    return json({ error: message }, status)
  }
}

export const GET = handler
export const POST = handler
export const DELETE = handler
export const OPTIONS = handler
