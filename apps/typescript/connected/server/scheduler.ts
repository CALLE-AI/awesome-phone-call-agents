import type { CheckInRequest } from './contract.js'

export type ScheduleReceipt = { state: 'queued'; messageId: string; nextCallAt: string } | { state: 'not_configured'; nextCallAt: string }

export async function scheduleNextCall(sourceCallId: string, request: CheckInRequest, nextCallAt: string): Promise<ScheduleReceipt> {
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
  const response = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(destination)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${qstashToken}`,
      'content-type': 'application/json',
      'upstash-not-before': String(Math.floor(timestamp / 1000)),
      'upstash-deduplication-id': `connected-${sourceCallId}`,
      'upstash-forward-authorization': `Bearer ${dispatchToken}`,
      'upstash-retries': '3',
    },
    body: JSON.stringify({ request: continuation }),
  })
  const body = await response.json() as { messageId?: string; error?: string }
  if (!response.ok || !body.messageId) throw new Error(body.error || 'The next companion call could not be queued.')
  return { state: 'queued', messageId: body.messageId, nextCallAt }
}
