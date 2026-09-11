import type { StoryCallRequest } from './call-contract.js'
import { assertLiveCallAuthorized, buildCallTask, idempotencyKey, storyResultSchema } from './call-contract.js'

export type CallSnapshot = { id: string; status?: string; structuredResult?: unknown }

export type PublicCallSummary = {
  id: string
  status: string
  resultReceived: boolean
}

export interface CallePort {
  create(input: Record<string, unknown>, options: { idempotencyKey: string }): Promise<CallSnapshot>
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>
}

export function buildCallInput(request: StoryCallRequest): Record<string, unknown> {
  return {
    task: buildCallTask(request),
    recipients: [{
      phones: [request.storytellerPhone],
      locale: request.locale,
      ...(request.region ? { region: request.region } : {}),
    }],
    resultSchema: storyResultSchema,
    metadata: { app: 'one-more-story', request_id: request.requestId },
  }
}

export async function dispatchStoryCall(
  request: StoryCallRequest,
  port: CallePort,
  liveSwitch = process.env.CALLE_LIVE_CALLS,
): Promise<CallSnapshot> {
  if (liveSwitch !== 'enabled') throw new Error('Live calls are disabled. Set CALLE_LIVE_CALLS=enabled only for an approved call.')
  assertLiveCallAuthorized(request)
  const callInput = buildCallInput(request)
  const call = await port.create(callInput, { idempotencyKey: idempotencyKey(request, callInput) })
  return port.waitForResult(call.id, { timeoutMs: 300_000, intervalMs: 2_000 })
}

export function summarizeCallSnapshot(snapshot: CallSnapshot): PublicCallSummary {
  return {
    id: snapshot.id,
    status: snapshot.status ?? 'unknown',
    resultReceived: snapshot.structuredResult !== undefined,
  }
}

export async function createSdkPort(): Promise<CallePort> {
  const apiKey = process.env.CALLE_API_KEY
  if (!apiKey) throw new Error('CALLE_API_KEY is required for a live call.')
  const { CalleClient } = await import('@call-e/calle')
  const client = new CalleClient({ apiKey, baseUrl: 'https://api.heycall-e.com' })
  return {
    create: (input, options) => client.calls.create(input as never, options) as Promise<CallSnapshot>,
    waitForResult: (callId, options) => client.calls.waitForResult(callId, options) as Promise<CallSnapshot>,
  }
}
