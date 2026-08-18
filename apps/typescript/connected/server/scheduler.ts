import { createHash } from 'node:crypto'
import type { CheckInRequest } from './contract.js'

const QSTASH_ORIGIN = 'https://qstash.upstash.io'

export type ScheduleReceipt = { state: 'queued'; messageId: string; nextCallAt: string; cancelledExisting: number } | { state: 'not_configured'; nextCallAt: string }
export type CancellationReceipt = { state: 'cancelled'; cancelled: number } | { state: 'not_configured'; cancelled: 0 }

export function cadenceLabel(participantId: string): string {
  if (!participantId.trim()) throw new Error('participantId is required to manage cadence.')
  return `connected-${createHash('sha256').update(participantId).digest('hex').slice(0, 24)}`
}

export async function cancelCadence(participantId: string, fetcher: typeof fetch = fetch): Promise<CancellationReceipt> {
  const qstashToken = process.env.QSTASH_TOKEN
  if (!qstashToken) return { state: 'not_configured', cancelled: 0 }
  const url = `${QSTASH_ORIGIN}/v2/messages?label=${encodeURIComponent(cadenceLabel(participantId))}`
  const response = await fetcher(url, { method: 'DELETE', headers: { authorization: `Bearer ${qstashToken}` } })
  const body = await response.json() as { cancelled?: number; error?: string }
  if (!response.ok || typeof body.cancelled !== 'number') throw new Error(body.error || 'Queued companion calls could not be cancelled.')
  return { state: 'cancelled', cancelled: body.cancelled }
}

export async function scheduleNextCall(sourceCallId: string, request: CheckInRequest, nextCallAt: string, fetcher: typeof fetch = fetch): Promise<ScheduleReceipt> {
  const qstashToken = process.env.QSTASH_TOKEN
  const dispatchToken = process.env.CONNECTED_DISPATCH_TOKEN
  const publicUrl = process.env.CONNECTED_PUBLIC_URL?.replace(/\/$/, '')
  if (!qstashToken || !dispatchToken || !publicUrl) return { state: 'not_configured', nextCallAt }

  const timestamp = Date.parse(nextCallAt)
  if (Number.isNaN(timestamp) || timestamp <= Date.now()) throw new Error('The agreed next call must be a future ISO timestamp.')
  const destination = `${publicUrl}/api/dispatch`
  const continuation: CheckInRequest = {
    ...request,
    runId: `${request.participantId}-${nextCallAt}`,
    scheduledWindow: nextCallAt,
    confirmOneCall: true,
  }
  const cancellation = await cancelCadence(request.participantId, fetcher)
  const response = await fetcher(`${QSTASH_ORIGIN}/v2/publish/${encodeURIComponent(destination)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${qstashToken}`,
      'content-type': 'application/json',
      'upstash-not-before': String(Math.floor(timestamp / 1000)),
      'upstash-deduplication-id': `connected-${sourceCallId}`,
      'upstash-label': cadenceLabel(request.participantId),
      'upstash-forward-authorization': `Bearer ${dispatchToken}`,
      'upstash-retries': '3',
    },
    body: JSON.stringify({ request: continuation }),
  })
  const body = await response.json() as { messageId?: string; error?: string }
  if (!response.ok || !body.messageId) throw new Error(body.error || 'The next companion call could not be queued.')
  return { state: 'queued', messageId: body.messageId, nextCallAt, cancelledExisting: cancellation.cancelled }
}
