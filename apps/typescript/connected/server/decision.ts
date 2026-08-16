import type { CheckInRequest, CheckInResult } from './contract.js'

export type ReviewAction =
  | 'close_no_consent'
  | 'cancel_future_calls'
  | 'operator_follow_up'
  | 'community_introduction_review'
  | 'event_reminder_review'
  | 'routine_follow_up'

export type PostCallPlan = {
  primaryAction: ReviewAction
  suppressFutureCalls: boolean
  deleteStoredMemory: boolean
  memoryToSave: string | null
  eventToReview: string | null
  reasons: string[]
}

export function decidePostCall(request: CheckInRequest, result: CheckInResult): PostCallPlan {
  const base = { suppressFutureCalls: false, deleteStoredMemory: result.deletion_requested, memoryToSave: null as string | null, eventToReview: null as string | null }
  if (result.opt_out) return { ...base, primaryAction: 'cancel_future_calls', suppressFutureCalls: true, reasons: ['Participant opted out.'] }
  if (result.permission_to_continue !== 'yes' || result.disclosure_acknowledged !== 'yes') {
    return { ...base, primaryAction: 'close_no_consent', reasons: ['Conversation consent was not established.'] }
  }

  const memoryToSave = result.memory_readback_confirmed === 'yes' ? result.confirmed_memory?.trim() || null : null
  if (result.wants_community_introduction) {
    return { ...base, memoryToSave, primaryAction: 'community_introduction_review', reasons: ['Participant explicitly requested a community introduction.'] }
  }
  const validEvent = request.eventOptions.find((event) => event.id === result.selected_event_id)?.id ?? null
  if (result.wants_event_reminder && validEvent) {
    return { ...base, memoryToSave, eventToReview: validEvent, primaryAction: 'event_reminder_review', reasons: ['Participant requested a reminder for a verified event.'] }
  }
  if (result.out_of_scope_request) {
    return { ...base, memoryToSave, primaryAction: 'operator_follow_up', reasons: ['Participant made an explicit request outside the companion workflow.'] }
  }
  return { ...base, memoryToSave, primaryAction: 'routine_follow_up', reasons: ['No intervention requested; continue the consented cadence.'] }
}
