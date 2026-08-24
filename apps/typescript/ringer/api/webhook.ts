import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * POST /api/webhook — receive terminal CALL-E events (call.completed, etc).
 *
 * Current CALL-E deliveries are unsigned. Validate the JSON envelope and
 * require `CALL-E-Event-Id` to match the body event id. That consistency check
 * is not sender authentication: this diagnostics-only endpoint performs no
 * business side effect. A production extension must durably deduplicate the
 * event id and reconcile the call through the authenticated Calls API before
 * trusting the notification.
 *
 * The live UI remains authoritative through polling, so this endpoint is
 * optional. Set CALLE_WEBHOOK_URL to opt a deployment into delivery.
 */

const MAX_BODY_BYTES = 1_048_576
const MAX_PROVIDER_ID_BYTES = 512
const ISO_8601_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
type TerminalEventType =
  | 'call.completed'
  | 'call.failed'
  | 'call.result_validation_failed'
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'call.completed',
  'call.failed',
  'call.result_validation_failed',
])

type HeaderMap = Record<string, string | string[] | undefined>

export interface AcceptedWebhookNotification {
  id: string
  type: TerminalEventType
  created_at: string
  data: { id: string }
}

export class WebhookInputError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WebhookInputError'
  }
}

// Ask Vercel not to pre-parse the body so this route can enforce its own limit.
export const config = { api: { bodyParser: false } }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'invalid_request', message: 'Use POST.' } })
    return
  }

  try {
    const rawBody = await readRawBody(req)
    const event = parseWebhookEvent(rawBody, req.headers)
    // Event and call IDs are attacker-controlled because current deliveries are
    // unsigned. Log only the allowlisted type so diagnostic traffic cannot
    // inject or reorder terminal output.
    console.log(`[webhook] accepted ${event.type}`)
    res.status(200).json({ ok: true })
  } catch (err) {
    if (err instanceof WebhookInputError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } })
      return
    }
    console.warn('[webhook] unexpected receiver error')
    res.status(500).json({ error: { code: 'internal_error', message: 'Webhook processing failed.' } })
  }
}

export function parseWebhookEvent(
  rawBody: string,
  headers: HeaderMap,
): AcceptedWebhookNotification {
  const contentType = singleHeader(headers, 'content-type')
  if (!contentType || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new WebhookInputError(400, 'invalid_content_type', 'Content-Type must be application/json.')
  }

  const headerEventId = singleHeader(headers, 'call-e-event-id')
  if (!headerEventId) {
    throw new WebhookInputError(400, 'missing_event_id', 'CALL-E-Event-Id is required.')
  }
  if (!isSafeProviderId(headerEventId)) {
    throw new WebhookInputError(400, 'invalid_event_id', 'CALL-E-Event-Id is invalid.')
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    throw new WebhookInputError(400, 'invalid_json', 'Webhook body must be valid JSON.')
  }
  if (!isObject(value)) {
    throw new WebhookInputError(400, 'invalid_event', 'Webhook body must be a JSON object.')
  }

  const eventId = value.id
  if (!isSafeProviderId(eventId)) {
    throw new WebhookInputError(400, 'invalid_event_id', 'Webhook event id is invalid.')
  }
  if (headerEventId !== eventId) {
    throw new WebhookInputError(400, 'event_id_mismatch', 'CALL-E-Event-Id must match the body id.')
  }
  if (typeof value.type !== 'string' || !TERMINAL_EVENT_TYPES.has(value.type)) {
    throw new WebhookInputError(400, 'unsupported_event_type', 'Webhook event type is not terminal.')
  }
  if (
    typeof value.created_at !== 'string' ||
    !isIso8601Timestamp(value.created_at)
  ) {
    throw new WebhookInputError(400, 'invalid_created_at', 'Webhook created_at must be an ISO timestamp.')
  }
  if (!isObject(value.data)) {
    throw new WebhookInputError(400, 'invalid_call_data', 'Webhook data must be a call object.')
  }
  if (!isSafeProviderId(value.data.id)) {
    throw new WebhookInputError(400, 'invalid_call_id', 'Webhook call id is invalid.')
  }

  return {
    id: eventId,
    type: value.type as TerminalEventType,
    created_at: value.created_at,
    data: { id: value.data.id },
  }
}

function singleHeader(headers: HeaderMap, name: string): string | undefined {
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name)
    .flatMap(([, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]))
  if (values.length > 1) {
    throw new WebhookInputError(400, 'duplicate_header', `Multiple ${name} headers are not allowed.`)
  }
  return values[0]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeProviderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_PROVIDER_ID_BYTES &&
    !hasUnsafeProviderIdCharacter(value)
  )
}

function hasUnsafeProviderIdCharacter(value: string): boolean {
  // Reject Unicode control, formatting, line-separator, and paragraph-separator
  // characters. This covers C0/C1 controls plus bidi and zero-width controls.
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
}

function isIso8601Timestamp(value: string): boolean {
  const match = ISO_8601_TIMESTAMP.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(value))
}

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) {
      throw new WebhookInputError(413, 'payload_too_large', 'Webhook body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
