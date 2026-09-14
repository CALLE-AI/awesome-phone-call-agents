import { createHash } from 'node:crypto'

export type EventOption = { id: string; title: string; when: string; place: string }

export type CheckInRequest = {
  runId: string
  participantId: string
  participantPhone: string
  participantName: string
  locale: string
  region?: string
  scheduledWindow: string
  conversationThreads: string[]
  eventOptions: EventOption[]
  contactConsentRecorded: boolean
  aiDisclosureApproved: boolean
  confirmOneCall: boolean
}

export type CheckInResult = {
  disclosure_acknowledged: 'yes' | 'no' | 'unknown'
  permission_to_continue: 'yes' | 'no' | 'unknown'
  conversation_enjoyed: 'yes' | 'no' | 'unknown'
  connection_pulse: 'more_connected' | 'same' | 'less_connected' | 'not_asked'
  confirmed_memory: string | null
  memory_readback_confirmed: 'yes' | 'no' | 'unknown'
  next_conversation_topic: string | null
  next_call_at: string | null
  selected_event_id: string | null
  wants_event_reminder: boolean
  wants_community_introduction: boolean
  out_of_scope_request: boolean
  opt_out: boolean
  deletion_requested: boolean
}

const E164 = /^\+[1-9]\d{7,14}$/
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/
const REQUEST_FIELDS = new Set([
  'runId', 'participantId', 'participantPhone', 'participantName', 'locale', 'region',
  'scheduledWindow', 'conversationThreads', 'eventOptions', 'contactConsentRecorded',
  'aiDisclosureApproved', 'confirmOneCall',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCheckInRequest(value: unknown): CheckInRequest {
  if (!isRecord(value)) throw new Error('The check-in request must be a JSON object.')
  const unknown = Object.keys(value).filter((key) => !REQUEST_FIELDS.has(key))
  if (unknown.length) throw new Error(`Unknown check-in request field: ${unknown[0]}.`)

  for (const key of ['runId', 'participantId', 'participantPhone', 'participantName', 'locale', 'scheduledWindow'] as const) {
    if (typeof value[key] !== 'string') throw new Error(`${key} must be a string.`)
  }
  if (value.region !== undefined && typeof value.region !== 'string') throw new Error('region must be a string when provided.')
  if (!Array.isArray(value.conversationThreads) || !value.conversationThreads.every((item) => typeof item === 'string')) {
    throw new Error('conversationThreads must be an array of strings.')
  }
  if (!Array.isArray(value.eventOptions) || !value.eventOptions.every((event) =>
    isRecord(event) && ['id', 'title', 'when', 'place'].every((key) => typeof event[key] === 'string'))) {
    throw new Error('eventOptions must contain id, title, when, and place strings.')
  }
  for (const key of ['contactConsentRecorded', 'aiDisclosureApproved', 'confirmOneCall'] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`${key} must be a boolean.`)
  }
  return value as CheckInRequest
}

export function parseCheckInResult(value: unknown): CheckInResult {
  if (!isRecord(value)) throw new Error('The CALL-E result must be a JSON object.')
  const resultFields = new Set(Object.keys(checkInResultSchema.properties))
  const unknown = Object.keys(value).filter((key) => !resultFields.has(key))
  if (unknown.length) throw new Error(`Unknown check-in result field: ${unknown[0]}.`)
  const stringEnums = {
    disclosure_acknowledged: ['yes', 'no', 'unknown'],
    permission_to_continue: ['yes', 'no', 'unknown'],
    conversation_enjoyed: ['yes', 'no', 'unknown'],
    connection_pulse: ['more_connected', 'same', 'less_connected', 'not_asked'],
    memory_readback_confirmed: ['yes', 'no', 'unknown'],
  } as const
  for (const [key, allowed] of Object.entries(stringEnums)) {
    if (!allowed.includes(value[key] as never)) throw new Error(`Invalid CALL-E result field: ${key}.`)
  }
  for (const key of ['confirmed_memory', 'next_conversation_topic', 'next_call_at', 'selected_event_id'] as const) {
    if (value[key] !== null && typeof value[key] !== 'string') throw new Error(`Invalid CALL-E result field: ${key}.`)
  }
  for (const key of ['wants_event_reminder', 'wants_community_introduction', 'out_of_scope_request', 'opt_out', 'deletion_requested'] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`Invalid CALL-E result field: ${key}.`)
  }
  return value as CheckInResult
}

export function assertLiveAuthorized(request: CheckInRequest): void {
  parseCheckInRequest(request)
  if (!E164.test(request.participantPhone)) throw new Error('participantPhone must be an explicit E.164 number.')
  if (!LOCALE.test(request.locale)) throw new Error('locale must be an explicit BCP 47 language tag.')
  if (!request.participantName.trim()) throw new Error('participantName is required.')
  if (!request.scheduledWindow.trim()) throw new Error('scheduledWindow is required.')
  for (const key of ['contactConsentRecorded', 'aiDisclosureApproved', 'confirmOneCall'] as const) {
    if (request[key] !== true) throw new Error(`${key} must be the exact boolean true.`)
  }
}

function quoteList(items: string[]): string {
  return items.length ? items.map((item) => `“${item}”`).join('; ') : 'none yet'
}

export function buildCallTask(request: CheckInRequest): string {
  const events = request.eventOptions.length
    ? request.eventOptions.map((event) => `${event.id}: ${event.title}, ${event.when}, ${event.place}`).join('; ')
    : 'No events are available for this call.'
  return [
    `Call ${request.participantName} for their consented Connected check-in during ${request.scheduledWindow}.`,
    'Start by clearly saying you are an AI calling from Connected and that the conversation may be processed and transcribed.',
    'Ask permission to continue. If the answer is not an explicit yes, thank them and end the call.',
    'Have a warm, unhurried conversation rather than reading a questionnaire. Never pretend to be human.',
    `Possible threads from conversations they previously approved for recall: ${quoteList(request.conversationThreads)}.`,
    'Treat those as optional conversation openers, not facts to expand or assumptions to make.',
    'Let the participant lead. Ask open questions, respond to what they say, and leave room for stories, humour, and ordinary conversation.',
    'Near the end, ask what they would enjoy talking about next time and whether this conversation helped them feel more connected today.',
    'Agree the next companion-call date and time with the participant. Return it as an ISO 8601 timestamp with an explicit UTC offset; return null if they do not choose one.',
    `Only if relevant, offer these verified community events: ${events}`,
    'Never claim a booking. Record interest and whether they want a reminder or an introduction to a human community coordinator.',
    'Save at most one new conversation thread. Read it back and save it only after explicit confirmation.',
    'If they ask for something outside companionship, event information, or community introductions, mark out_of_scope_request for an operator.',
    'Do not diagnose, assess severity, or give medical, legal, financial, or emergency advice.',
    'If emergency help is requested, say Connected is not an emergency service and advise contacting local emergency services. Do not assess or monitor risk.',
    'Honor any request to stop future calls or delete remembered information.',
  ].join(' ')
}

export const checkInResultSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'disclosure_acknowledged', 'permission_to_continue', 'conversation_enjoyed', 'connection_pulse', 'confirmed_memory',
    'memory_readback_confirmed', 'next_conversation_topic', 'next_call_at', 'selected_event_id', 'wants_event_reminder',
    'wants_community_introduction', 'out_of_scope_request', 'opt_out',
    'deletion_requested',
  ],
  properties: {
    disclosure_acknowledged: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    permission_to_continue: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    conversation_enjoyed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    connection_pulse: { type: 'string', enum: ['more_connected', 'same', 'less_connected', 'not_asked'] },
    confirmed_memory: { type: ['string', 'null'] },
    memory_readback_confirmed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    next_conversation_topic: { type: ['string', 'null'] },
    next_call_at: { type: ['string', 'null'] },
    selected_event_id: { type: ['string', 'null'] },
    wants_event_reminder: { type: 'boolean' },
    wants_community_introduction: { type: 'boolean' },
    out_of_scope_request: { type: 'boolean' },
    opt_out: { type: 'boolean' },
    deletion_requested: { type: 'boolean' },
  },
} as const

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function idempotencyKey(request: CheckInRequest, payload: Record<string, unknown>): string {
  return `connected-${createHash('sha256').update(canonicalJson({ authorization: request, payload })).digest('hex').slice(0, 20)}`
}
