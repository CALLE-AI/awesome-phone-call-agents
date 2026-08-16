import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCallInput, dispatchCheckIn, publicSummary, type CallePort } from '../server/calle.js'
import { idempotencyKey, parseCheckInRequest, type CheckInRequest, type CheckInResult } from '../server/contract.js'
import { decidePostCall } from '../server/decision.js'

const request: CheckInRequest = {
  runId: 'run-1', participantId: 'person-1', participantPhone: '+12025550147', participantName: 'Margaret',
  locale: 'en-GB', region: 'GB', scheduledWindow: 'Friday afternoon', conversationThreads: ['balcony tomatoes'],
  eventOptions: [{ id: 'history-tea', title: 'Tea and local history', when: 'Tuesday at 2 PM', place: 'Riverside Library' }],
  contactConsentRecorded: true, aiDisclosureApproved: true, confirmOneCall: true,
}

const result: CheckInResult = {
  disclosure_acknowledged: 'yes', permission_to_continue: 'yes', conversation_enjoyed: 'yes', connection_pulse: 'more_connected',
  confirmed_memory: 'The first tomato turned red.', memory_readback_confirmed: 'yes', next_conversation_topic: 'Leo’s school play',
  selected_event_id: null, wants_event_reminder: false, wants_community_introduction: false,
  out_of_scope_request: false, opt_out: false, deletion_requested: false,
}

function fakePort(): CallePort & { creates: number } {
  return { creates: 0, async create() { this.creates += 1; return { id: 'call-1', status: 'queued' } }, async waitForResult() { return { id: 'call-1', status: 'completed' } } }
}

test('the JSON boundary rejects unknown fields and non-boolean consent', () => {
  assert.deepEqual(parseCheckInRequest(request), request)
  assert.throws(() => parseCheckInRequest({ ...request, confirmOneCall: 'true' }), /must be a boolean/)
  assert.throws(() => parseCheckInRequest({ ...request, hidden: true }), /Unknown check-in request field/)
})

test('live dispatch is disabled before CALL-E receives anything', async () => {
  const port = fakePort()
  await assert.rejects(dispatchCheckIn(request, port, 'disabled'), /Live calls are disabled/)
  assert.equal(port.creates, 0)
})

test('every authorization gate is exact and an invalid phone fails closed', async () => {
  for (const key of ['contactConsentRecorded', 'aiDisclosureApproved', 'confirmOneCall'] as const) {
    const port = fakePort()
    await assert.rejects(dispatchCheckIn({ ...request, [key]: false }, port, 'enabled'))
    assert.equal(port.creates, 0)
  }
  const port = fakePort()
  await assert.rejects(dispatchCheckIn({ ...request, participantPhone: '020 555 0147' }, port, 'enabled'), /E.164/)
  assert.equal(port.creates, 0)
})

test('the CALL-E payload has one recipient and a closed result schema', () => {
  const input = buildCallInput(request) as { recipients: unknown[]; resultSchema: { additionalProperties: boolean } }
  assert.equal(input.recipients.length, 1)
  assert.equal(input.resultSchema.additionalProperties, false)
})

test('idempotency binds the authorization and normalized payload', () => {
  const input = buildCallInput(request)
  const key = idempotencyKey(request, input)
  assert.notEqual(idempotencyKey({ ...request, runId: 'run-2' }, buildCallInput({ ...request, runId: 'run-2' })), key)
  assert.notEqual(idempotencyKey(request, { ...input, metadata: { app: 'changed' } }), key)
})

test('opt-out cancels the cadence before any other action', () => {
  const plan = decidePostCall(request, { ...result, opt_out: true, wants_community_introduction: true })
  assert.equal(plan.primaryAction, 'cancel_future_calls')
  assert.equal(plan.suppressFutureCalls, true)
})

test('lack of conversation consent stores nothing', () => {
  const plan = decidePostCall(request, { ...result, permission_to_continue: 'unknown', confirmed_memory: 'private', selected_event_id: 'history-tea', wants_event_reminder: true })
  assert.equal(plan.primaryAction, 'close_no_consent')
  assert.equal(plan.memoryToSave, null)
  assert.equal(plan.eventToReview, null)
})

test('community introduction requires an explicit participant request', () => {
  assert.equal(decidePostCall(request, { ...result, wants_community_introduction: true }).primaryAction, 'community_introduction_review')
  assert.equal(decidePostCall(request, result).primaryAction, 'routine_follow_up')
})

test('memory is saved only after confirmed read-back', () => {
  assert.equal(decidePostCall(request, result).memoryToSave, 'The first tomato turned red.')
  assert.equal(decidePostCall(request, { ...result, memory_readback_confirmed: 'unknown' }).memoryToSave, null)
})

test('only a verified offered event can enter reminder review', () => {
  const valid = decidePostCall(request, { ...result, selected_event_id: 'history-tea', wants_event_reminder: true })
  assert.equal(valid.primaryAction, 'event_reminder_review')
  assert.equal(valid.eventToReview, 'history-tea')
  const invented = decidePostCall(request, { ...result, selected_event_id: 'invented-event', wants_event_reminder: true })
  assert.equal(invented.primaryAction, 'routine_follow_up')
  assert.equal(invented.eventToReview, null)
})

test('public output excludes phone, transcript, and conversation content', () => {
  const summary = publicSummary({ id: 'call-1', status: 'completed', structuredResult: { phone: request.participantPhone, transcript: 'private', memory: 'private' } })
  assert.deepEqual(summary, { id: 'call-1', status: 'completed', resultReceived: true })
  assert.doesNotMatch(JSON.stringify(summary), /12025550147|private/)
})
