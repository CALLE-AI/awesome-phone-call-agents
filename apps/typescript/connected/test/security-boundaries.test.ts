import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { Call } from '@call-e/calle'
import { projectCall } from '../api/connected.js'
import { bindCompletedCall, buildCallInput, OFFICIAL_CALLE_ORIGIN } from '../server/calle.js'
import type { CheckInRequest, CheckInResult } from '../server/contract.js'
import { cadenceLabel, cancelCadence, scheduleNextCall } from '../server/scheduler.js'

const request: CheckInRequest = {
  runId: 'run-bound-1', participantId: 'person-bound-1', participantPhone: '+12025550147', participantName: 'Margaret',
  locale: 'en-GB', region: 'GB', scheduledWindow: 'Friday afternoon', conversationThreads: ['balcony tomatoes'],
  eventOptions: [{ id: 'history-tea', title: 'Tea and local history', when: 'Tuesday at 2 PM', place: 'Riverside Library' }],
  contactConsentRecorded: true, aiDisclosureApproved: true, confirmOneCall: true,
}

const result: CheckInResult = {
  disclosure_acknowledged: 'yes', permission_to_continue: 'yes', conversation_enjoyed: 'yes', connection_pulse: 'more_connected',
  confirmed_memory: 'The first tomato turned red.', memory_readback_confirmed: 'yes', next_conversation_topic: 'Leo’s school play',
  next_call_at: '2026-08-21T14:30:00+01:00', selected_event_id: null, wants_event_reminder: false,
  wants_community_introduction: false, out_of_scope_request: false, opt_out: false, deletion_requested: false,
}

function completedCall(): Call {
  const input = buildCallInput(request)
  return {
    id: 'call_bound_1', object: 'call_task', status: 'completed', task: input.task as string,
    recipients: [{
      id: 'recipient-1', phones: [request.participantPhone], locale: request.locale, region: request.region ?? null,
      status: 'completed', structuredResult: result, summary: 'A completed companion conversation.',
      attempts: [{ id: 'attempt-1', phone: request.participantPhone, status: 'completed', startedAt: '2026-08-17T12:00:00Z', completedAt: '2026-08-17T12:04:00Z', summary: 'Conversation completed.', transcriptTurns: [{ offset_seconds: 1, speaker: 'bot', text: 'Hello Margaret.' }], providerCallId: 'provider-1', failureCode: null, failureMessage: null }],
    }],
    structuredResult: null, summary: 'The participant completed the conversation.', taskCompleted: true,
    completionConfidence: { score: 0.98, label: 'high' }, evidence: ['The participant agreed to the next call time.'],
    metadata: input.metadata as Record<string, unknown>, failureCode: null, failureMessage: null,
    createdAt: '2026-08-17T12:00:00Z', completedAt: '2026-08-17T12:04:01Z',
  }
}

test('completed results bind exact call, task, recipient, metadata, and evidence', () => {
  const bound = bindCompletedCall(completedCall(), 'call_bound_1')
  assert.deepEqual(bound.request, request)
  assert.deepEqual(bound.result, result)
  assert.deepEqual(bound.offeredEventIds, ['history-tea'])
})

test('partial, failed, mismatched, and unsupported result sources fail closed', () => {
  const cases: Call[] = [
    { ...completedCall(), status: 'failed' },
    { ...completedCall(), taskCompleted: false },
    { ...completedCall(), evidence: [] },
    { ...completedCall(), task: 'Different task' },
    { ...completedCall(), metadata: { ...completedCall().metadata, run_id: 'wrong-run' } },
    { ...completedCall(), recipients: [{ ...completedCall().recipients[0], phones: ['+12025550199'] }] },
    { ...completedCall(), recipients: [{ ...completedCall().recipients[0], structuredResult: null }] },
    { ...completedCall(), recipients: [{ ...completedCall().recipients[0], attempts: [] }] },
  ]
  for (const call of cases) assert.throws(() => bindCompletedCall(call, 'call_bound_1'), /CALL-E result rejected/)
  assert.throws(() => bindCompletedCall(completedCall(), 'call_other'), /call identity/)
})

test('all credentialed CALL-E clients are pinned to the official HTTPS origin', async () => {
  assert.equal(OFFICIAL_CALLE_ORIGIN, 'https://api.heycall-e.com')
  for (const path of ['../server/calle.ts', '../api/connected.ts', '../api/dispatch.ts']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /CALLE_BASE_URL/)
  }
})

test('scheduling cancels any queued cadence label before publishing one replacement', async () => {
  const previous = { qstash: process.env.QSTASH_TOKEN, dispatch: process.env.CONNECTED_DISPATCH_TOKEN, url: process.env.CONNECTED_PUBLIC_URL }
  process.env.QSTASH_TOKEN = 'qstash-test-token'
  process.env.CONNECTED_DISPATCH_TOKEN = 'dispatch-test-token'
  process.env.CONNECTED_PUBLIC_URL = 'https://connected.example'
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return calls.length === 1 ? Response.json({ cancelled: 2 }) : Response.json({ messageId: 'msg-next-1' })
  }) as typeof fetch
  try {
    const receipt = await scheduleNextCall('call-source-1', request, '2026-08-21T14:30:00+01:00', fakeFetch)
    assert.deepEqual(receipt, { state: 'queued', messageId: 'msg-next-1', nextCallAt: '2026-08-21T14:30:00+01:00', cancelledExisting: 2 })
    assert.match(calls[0].url, /\/v2\/messages\?label=/)
    assert.match(calls[1].url, /\/v2\/publish\//)
    assert.equal(new Headers(calls[1].init?.headers).get('upstash-label'), cadenceLabel(request.participantId))
  } finally {
    if (previous.qstash === undefined) delete process.env.QSTASH_TOKEN; else process.env.QSTASH_TOKEN = previous.qstash
    if (previous.dispatch === undefined) delete process.env.CONNECTED_DISPATCH_TOKEN; else process.env.CONNECTED_DISPATCH_TOKEN = previous.dispatch
    if (previous.url === undefined) delete process.env.CONNECTED_PUBLIC_URL; else process.env.CONNECTED_PUBLIC_URL = previous.url
  }
})

test('explicit cancellation deletes already queued QStash messages by participant cadence label', async () => {
  const previous = process.env.QSTASH_TOKEN
  process.env.QSTASH_TOKEN = 'qstash-test-token'
  let observed = ''
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observed = `${init?.method} ${String(input)}`
    return Response.json({ cancelled: 3 })
  }) as typeof fetch
  try {
    assert.deepEqual(await cancelCadence(request.participantId, fakeFetch), { state: 'cancelled', cancelled: 3 })
    assert.match(observed, /^DELETE https:\/\/qstash\.upstash\.io\/v2\/messages\?label=/)
  } finally {
    if (previous === undefined) delete process.env.QSTASH_TOKEN; else process.env.QSTASH_TOKEN = previous
  }
})

test('an evidence-bound in-call opt-out cancels queued cadence and never schedules', async () => {
  const call = completedCall()
  call.recipients[0].structuredResult = { ...result, opt_out: true }
  let cancelledFor = ''
  let schedules = 0
  const projected = await projectCall(call, call.id, {
    async cancel(participantId) { cancelledFor = participantId; return { state: 'cancelled', cancelled: 2 } },
    async schedule() { schedules += 1; return { state: 'queued', messageId: 'should-not-exist', nextCallAt: result.next_call_at!, cancelledExisting: 0 } },
  })
  assert.equal(cancelledFor, request.participantId)
  assert.equal(schedules, 0)
  assert.deepEqual(projected.cancellation, { state: 'cancelled', cancelled: 2 })
  assert.equal(projected.schedule, null)
  assert.equal(projected.plan.suppressFutureCalls, true)
})
