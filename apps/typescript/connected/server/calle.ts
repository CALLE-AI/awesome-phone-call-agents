import type { Call } from '@call-e/calle'
import type { CheckInRequest, CheckInResult } from './contract.js'
import { assertLiveAuthorized, buildCallTask, canonicalJson, checkInResultSchema, idempotencyKey, parseCheckInRequest, parseCheckInResult } from './contract.js'

export const OFFICIAL_CALLE_ORIGIN = 'https://api.heycall-e.com'

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

const METADATA_FIELDS = ['app', 'workflow_version', 'run_id', 'participant_id', 'offered_event_ids', 'continuation_request']

export type BoundCompletedCall = {
  request: CheckInRequest
  result: CheckInResult
  offeredEventIds: string[]
}

function reject(reason: string): never {
  throw new Error(`CALL-E result rejected: ${reason}.`)
}

export function bindCompletedCall(call: Call, expectedCallId: string): BoundCompletedCall {
  if (call.id !== expectedCallId || call.object !== 'call_task') reject('call identity did not match')
  if (call.status !== 'completed' || call.taskCompleted !== true || !call.completedAt) reject('call and task were not completed')
  if (!Array.isArray(call.evidence) || call.evidence.length === 0 || !call.evidence.every((item) => typeof item === 'string' && item.trim())) {
    reject('completed-call evidence was missing')
  }

  const metadataKeys = Object.keys(call.metadata).sort()
  if (canonicalJson(metadataKeys) !== canonicalJson([...METADATA_FIELDS].sort())) reject('metadata shape did not match')
  if (call.metadata.app !== 'connected' || call.metadata.workflow_version !== '1') reject('workflow metadata did not match')
  const request = parseCheckInRequest(call.metadata.continuation_request)
  const expectedInput = buildCallInput(request)
  if (call.task !== expectedInput.task) reject('task text did not match the authorized request')
  if (call.metadata.run_id !== request.runId || call.metadata.participant_id !== request.participantId) reject('request metadata did not match')

  const expectedEvents = request.eventOptions.map((event) => event.id)
  if (canonicalJson(call.metadata.offered_event_ids) !== canonicalJson(expectedEvents)) reject('offered events did not match')
  if (canonicalJson(call.metadata.continuation_request) !== canonicalJson(request)) reject('continuation request did not match')

  if (call.recipients.length !== 1) reject('recipient count did not match')
  const recipient = call.recipients[0]
  if (recipient.status !== 'completed' || canonicalJson(recipient.phones) !== canonicalJson([request.participantPhone])) reject('recipient did not match')
  if (recipient.locale !== request.locale || recipient.region !== (request.region ?? null)) reject('recipient locale or region did not match')
  const completedAttempt = recipient.attempts.some((attempt) =>
    attempt.status === 'completed' && attempt.phone === request.participantPhone && Boolean(attempt.completedAt)
      && (attempt.transcriptTurns.length > 0 || Boolean(attempt.summary?.trim())))
  if (!completedAttempt) reject('recipient evidence was not bound to a completed attempt')
  if (!recipient.summary?.trim() || !recipient.structuredResult) reject('recipient result evidence was incomplete')

  return { request, result: parseCheckInResult(recipient.structuredResult), offeredEventIds: expectedEvents }
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
  const client = new CalleClient({ apiKey, baseUrl: OFFICIAL_CALLE_ORIGIN })
  return {
    create: (input, options) => client.calls.create(input as never, options) as Promise<CallSnapshot>,
    waitForResult: (id, options) => client.calls.waitForResult(id, options) as Promise<CallSnapshot>,
  }
}

export function publicSummary(snapshot: CallSnapshot) {
  return { id: snapshot.id, status: snapshot.status ?? 'unknown', resultReceived: snapshot.structuredResult !== undefined }
}
