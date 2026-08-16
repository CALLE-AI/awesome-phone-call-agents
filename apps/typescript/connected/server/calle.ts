import type { CheckInRequest } from './contract.js'
import { assertLiveAuthorized, buildCallTask, checkInResultSchema, idempotencyKey } from './contract.js'

export type CallSnapshot = { id: string; status?: string; structuredResult?: unknown; recipients?: Array<{ structuredResult?: unknown }> }
export interface CallePort {
  create(input: Record<string, unknown>, options: { idempotencyKey: string }): Promise<CallSnapshot>
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>
}

export function buildCallInput(request: CheckInRequest): Record<string, unknown> {
  return {
    task: buildCallTask(request),
    recipients: [{ phones: [request.participantPhone], locale: request.locale, ...(request.region ? { region: request.region } : {}) }],
    recipientResultSchema: checkInResultSchema,
    metadata: {
      app: 'connected',
      workflow_version: '1',
      run_id: request.runId,
      participant_id: request.participantId,
      offered_event_ids: request.eventOptions.map((event) => event.id),
      continuation_request: request,
    },
  }
}

export async function dispatchCheckIn(request: CheckInRequest, port: CallePort, liveSwitch = process.env.CALLE_LIVE_CALLS): Promise<CallSnapshot> {
  if (liveSwitch !== 'enabled') throw new Error('Live calls are disabled. Set CALLE_LIVE_CALLS=enabled only for an approved call.')
  assertLiveAuthorized(request)
  const input = buildCallInput(request)
  const call = await port.create(input, { idempotencyKey: idempotencyKey(request, input) })
  return port.waitForResult(call.id, { timeoutMs: 300_000, intervalMs: 2_000 })
}

export async function createSdkPort(): Promise<CallePort> {
  const apiKey = process.env.CALLE_API_KEY
  if (!apiKey) throw new Error('CALLE_API_KEY is required for a live call.')
  const { CalleClient } = await import('@call-e/calle')
  const client = new CalleClient({ apiKey, baseUrl: 'https://api.heycall-e.com' })
  return {
    create: (input, options) => client.calls.create(input as never, options) as Promise<CallSnapshot>,
    waitForResult: (id, options) => client.calls.waitForResult(id, options) as Promise<CallSnapshot>,
  }
}

export function publicSummary(snapshot: CallSnapshot) {
  return { id: snapshot.id, status: snapshot.status ?? 'unknown', resultReceived: snapshot.structuredResult !== undefined }
}
