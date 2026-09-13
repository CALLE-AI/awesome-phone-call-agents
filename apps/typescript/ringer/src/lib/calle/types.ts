/**
 * Client-safe mirror of the CALL-E Developer API object model.
 *
 * These types intentionally duplicate the shapes generated from CALL-E's
 * OpenAPI schema (see `@call-e/calle`) so that browser code can stay fully
 * typed without importing the server SDK (which must never ship the API key
 * to the client). The serverless proxy in `/api` uses the real SDK; the
 * browser talks only to our proxy and to the demo engine, both of which
 * return objects that conform to these types.
 */

export type CallStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'canceled'

export type RecipientStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'

export type AttemptStatus =
  | 'queued'
  | 'dialing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'canceled'

export type TranscriptSpeaker = 'bot' | 'user' | 'unknown'

export type EventLevel = 'debug' | 'info' | 'warning' | 'error'

export type JsonObject = Record<string, unknown>

export interface CompletionConfidence {
  /** 0..1 confidence score for CALL-E's task-completion judgment. */
  score: number
  /** Label such as `low`, `medium`, or `high`. */
  label: string
}

export interface CallTranscriptTurn {
  offset_seconds: number | null
  speaker: TranscriptSpeaker
  text: string
}

export interface CallAttempt {
  id: string
  phone: string
  status: AttemptStatus
  started_at: string | null
  completed_at: string | null
  summary: string | null
  transcript_turns: CallTranscriptTurn[]
  provider_call_id: string | null
  failure_code: string | null
  failure_message: string | null
}

export interface CallRecipient {
  id: string
  phones: string[]
  locale: string | null
  region: string | null
  status: RecipientStatus
  structured_result: JsonObject | null
  summary: string | null
  attempts: CallAttempt[]
}

export interface CallTask {
  id: string
  object: 'call_task'
  status: CallStatus
  task: string
  recipients: CallRecipient[]
  structured_result: JsonObject | null
  summary: string | null
  task_completed: boolean | null
  completion_confidence: CompletionConfidence | null
  evidence: string[]
  metadata: JsonObject
  failure_code: string | null
  failure_message: string | null
  created_at: string
  completed_at: string | null
}

export interface DeveloperEvent {
  id: string
  type: string
  call_id: string
  created_at: string
  level: EventLevel
  status: CallStatus
  message: string
  details: JsonObject
}

export interface EventList {
  object: 'list'
  data: DeveloperEvent[]
  next_cursor?: string | null
}

/** Recipient shape accepted by the create-call request. */
export interface CreateRecipient {
  phones: string[]
  locale?: string | null
  region?: string | null
}

/** Body we POST to our own `/api/calls` proxy (mirrors CreateCallRequest). */
export interface CreateCallBody {
  task: string
  recipients?: CreateRecipient[]
  result_schema?: JsonObject | null
  recipient_result_schema?: JsonObject | null
  metadata?: JsonObject
  webhook_url?: string
}

/** Stable API error codes returned by CALL-E. */
export type CalleErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limit_exceeded'
  | 'insufficient_balance'
  | 'unsupported_region'
  | 'unsupported_language'
  | 'recipient_blocked'
  | 'policy_violation'
  | 'call_not_ready'
  | 'no_recipients'
  | 'invalid_recipient'
  | 'invalid_phone'
  | 'result_schema_invalid'
  | 'recipient_result_schema_invalid'
  | 'idempotency_conflict'
  | 'provider_unavailable'
  | 'internal_error'
  | 'not_found'

export interface CalleApiError {
  code: CalleErrorCode | string
  message: string
  details?: JsonObject
}

export const TERMINAL_STATUSES: readonly CallStatus[] = [
  'completed',
  'failed',
  'canceled',
]

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
