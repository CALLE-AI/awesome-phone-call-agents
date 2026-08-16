import type { CheckInRequest, CheckInResult, EventOption } from '../server/contract.js'
import type { PostCallPlan, ReviewAction } from '../server/decision.js'

export type Participant = {
  id: string
  initials: string
  name: string
  phone: string
  locale: string
  region: string
  scheduledWindow: string
  next: string
  memories: string[]
  nextTopic: string
  tone: string
  action: string
  consentRecorded: boolean
  aiDisclosureApproved: boolean
  active: boolean
}

export type TimelineItem = { id: string; participantId: string; time: string; title: string; text: string }
export type FollowUp = { id: string; participantId: string; kind: ReviewAction; title: string; status: 'open' | 'completed'; createdAt: string }
export type RunRecord = { id: string; participantId: string; provider: 'demo' | 'calle'; status: string; enjoyed: boolean; completedAt: string | null }
export type ConnectedState = { participants: Participant[]; timeline: TimelineItem[]; followUps: FollowUp[]; runs: RunRecord[] }

export const eventOptions: EventOption[] = [
  { id: 'event-library-history', title: 'Tea and local history', when: 'Tuesday at 2:00 PM', place: 'Riverside Library' },
  { id: 'event-garden-circle', title: 'Community garden circle', when: 'Thursday at 11:00 AM', place: 'Willow Park' },
]

export const initialState: ConnectedState = {
  participants: [
    { id: 'margaret', initials: 'MH', name: 'Margaret H.', phone: '', locale: 'en-GB', region: 'GB', scheduledWindow: 'Friday afternoon', next: 'Today · 2:30 PM', memories: ['The tomatoes on the balcony', 'Grandson Leo’s school play'], nextTopic: 'Ask whether the first tomato beat the birds.', tone: 'Steady', action: 'Check-in ready', consentRecorded: true, aiDisclosureApproved: true, active: true },
    { id: 'arthur', initials: 'AP', name: 'Arthur P.', phone: '', locale: 'en-GB', region: 'GB', scheduledWindow: 'Tuesday morning', next: 'Tomorrow · 10:00 AM', memories: ['Local history', 'Chess'], nextTopic: 'Ask about the chess puzzle he was trying.', tone: 'Brighter', action: 'Event reminder', consentRecorded: true, aiDisclosureApproved: true, active: true },
    { id: 'ruth', initials: 'RS', name: 'Ruth S.', phone: '', locale: 'en-GB', region: 'GB', scheduledWindow: 'Friday afternoon', next: 'Friday · 4:00 PM', memories: ['Choir music', 'Neighbourhood walks'], nextTopic: 'Ask which choir song stayed with her.', tone: 'Follow-up', action: 'Community introduction', consentRecorded: true, aiDisclosureApproved: true, active: true },
  ],
  timeline: [
    { id: 't1', participantId: 'margaret', time: '2:31', title: 'Consent confirmed', text: 'Margaret chose to continue after the AI disclosure.' },
    { id: 't2', participantId: 'margaret', time: '2:39', title: 'A new thread, in her words', text: '“The first tomato finally turned red.” Read back and confirmed.' },
    { id: 't3', participantId: 'margaret', time: '2:42', title: 'Something to anticipate', text: 'Interested in Tuesday’s local history tea; reminder requested.' },
  ],
  followUps: [{ id: 'f1', participantId: 'ruth', kind: 'community_introduction_review', title: 'Introduce Ruth to community coordinator Maya', status: 'open', createdAt: 'Today' }],
  runs: [
    { id: 'demo-1', participantId: 'margaret', provider: 'demo', status: 'completed', enjoyed: true, completedAt: 'Today' },
    { id: 'demo-2', participantId: 'arthur', provider: 'demo', status: 'completed', enjoyed: true, completedAt: 'Yesterday' },
  ],
}

export const demoResult: CheckInResult = {
  disclosure_acknowledged: 'yes', permission_to_continue: 'yes', conversation_enjoyed: 'yes', connection_pulse: 'more_connected',
  confirmed_memory: 'The first balcony tomato turned red.', memory_readback_confirmed: 'yes', next_conversation_topic: 'Leo’s school play',
  next_call_at: '2026-08-21T14:30:00+01:00',
  selected_event_id: 'event-library-history', wants_event_reminder: true, wants_community_introduction: false,
  out_of_scope_request: false, opt_out: false, deletion_requested: false,
}

export const demoPlan: PostCallPlan = {
  primaryAction: 'event_reminder_review', suppressFutureCalls: false, deleteStoredMemory: false,
  memoryToSave: demoResult.confirmed_memory, nextCallAt: demoResult.next_call_at, eventToReview: 'event-library-history', reasons: ['Participant requested a reminder for a verified event.'],
}

export function toCheckInRequest(participant: Participant): CheckInRequest {
  return {
    runId: `${participant.id}-${new Date().toISOString().slice(0, 16)}`,
    participantId: participant.id,
    participantPhone: participant.phone,
    participantName: participant.name,
    locale: participant.locale,
    region: participant.region,
    scheduledWindow: participant.scheduledWindow,
    conversationThreads: participant.memories,
    eventOptions,
    contactConsentRecorded: participant.consentRecorded,
    aiDisclosureApproved: participant.aiDisclosureApproved,
    confirmOneCall: true,
  }
}

function actionLabel(action: ReviewAction): string {
  return {
    close_no_consent: 'Consent not established', cancel_future_calls: 'Cadence cancelled', operator_follow_up: 'Operator follow-up',
    community_introduction_review: 'Community introduction', event_reminder_review: 'Event reminder', routine_follow_up: 'Next chat ready',
  }[action]
}

export function applyCompletedRun(state: ConnectedState, participantId: string, result: CheckInResult, plan: PostCallPlan, callId: string, provider: 'demo' | 'calle'): ConnectedState {
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const participants = state.participants.map((participant) => {
    if (participant.id !== participantId) return participant
    const memories = plan.deleteStoredMemory ? [] : plan.memoryToSave && !participant.memories.includes(plan.memoryToSave)
      ? [...participant.memories, plan.memoryToSave] : participant.memories
    return {
      ...participant,
      memories,
      nextTopic: result.next_conversation_topic || participant.nextTopic,
      next: plan.nextCallAt ? new Date(plan.nextCallAt).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : participant.next,
      tone: result.connection_pulse === 'more_connected' ? 'More connected' : result.connection_pulse === 'less_connected' ? 'Less connected' : 'Steady',
      action: actionLabel(plan.primaryAction),
      active: plan.suppressFutureCalls ? false : participant.active,
    }
  })
  const additions: TimelineItem[] = [
    { id: `${callId}-complete`, participantId, time, title: 'Conversation completed', text: result.conversation_enjoyed === 'yes' ? 'The participant said they enjoyed the conversation.' : 'Conversation outcome recorded without inference.' },
  ]
  if (plan.memoryToSave) additions.push({ id: `${callId}-memory`, participantId, time, title: 'Remembered with permission', text: `“${plan.memoryToSave}” was read back and confirmed.` })
  if (result.next_conversation_topic) additions.push({ id: `${callId}-next`, participantId, time, title: 'A beginning for next time', text: `Next topic: ${result.next_conversation_topic}.` })
  if (plan.nextCallAt) additions.push({ id: `${callId}-scheduled`, participantId, time, title: 'Next companion call scheduled', text: new Date(plan.nextCallAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })

  const followUps = plan.primaryAction === 'routine_follow_up' || plan.primaryAction === 'close_no_consent'
    ? state.followUps
    : [...state.followUps, { id: `${callId}-follow-up`, participantId, kind: plan.primaryAction, title: actionLabel(plan.primaryAction), status: 'open' as const, createdAt: 'Just now' }]
  return {
    participants,
    timeline: [...state.timeline, ...additions],
    followUps,
    runs: [...state.runs, { id: callId, participantId, provider, status: 'completed', enjoyed: result.conversation_enjoyed === 'yes', completedAt: 'Just now' }],
  }
}

export function completeFollowUp(state: ConnectedState, id: string): ConnectedState {
  return { ...state, followUps: state.followUps.map((item) => item.id === id ? { ...item, status: 'completed' } : item) }
}
