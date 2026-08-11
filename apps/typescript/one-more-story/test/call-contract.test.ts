import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCallInput, dispatchStoryCall, summarizeCallSnapshot, type CallePort } from '../server/calle.js'
import { idempotencyKey, isConfirmedStory, type StoryCallRequest } from '../server/call-contract.js'
import { applyCorrection } from '../src/data/storyState.js'

const authorized: StoryCallRequest = {
  requestId: 'test-001', storytellerPhone: '+15555550123', locale: 'en-US', region: 'US',
  familyName: 'Mara', question: 'What did the market smell like?',
  contactPermission: true, aiDisclosureApproved: true, confirmIntent: true,
}

function fakePort(): CallePort & { creates: number } {
  return {
    creates: 0,
    async create() { this.creates += 1; return { id: 'call_test', status: 'queued' } },
    async waitForResult() { return { id: 'call_test', status: 'completed' } },
  }
}

test('live switch blocks before CALL-E receives anything', async () => {
  const port = fakePort()
  await assert.rejects(dispatchStoryCall(authorized, port, 'disabled'), /Live calls are disabled/)
  assert.equal(port.creates, 0)
})

test('contact permission and fresh intent are both mandatory', async () => {
  for (const field of ['contactPermission', 'confirmIntent'] as const) {
    const port = fakePort()
    await assert.rejects(dispatchStoryCall({ ...authorized, [field]: false }, port, 'enabled'))
    assert.equal(port.creates, 0)
  }
})

test('an invalid phone is rejected before dispatch', async () => {
  const port = fakePort()
  await assert.rejects(dispatchStoryCall({ ...authorized, storytellerPhone: '555-0100' }, port, 'enabled'), /E.164/)
  assert.equal(port.creates, 0)
})

test('idempotency binds every approved request field and the normalized CALL-E payload', () => {
  const baseInput = buildCallInput(authorized)
  const baseKey = idempotencyKey(authorized, baseInput)
  const mutations: StoryCallRequest[] = [
    { ...authorized, requestId: 'test-002' },
    { ...authorized, storytellerPhone: '+15555550124' },
    { ...authorized, locale: 'es-US' },
    { ...authorized, region: 'CA' },
    { ...authorized, familyName: 'Nora' },
    { ...authorized, question: 'What did the roses smell like?' },
    { ...authorized, contactPermission: false },
    { ...authorized, aiDisclosureApproved: false },
    { ...authorized, confirmIntent: false },
  ]

  for (const request of mutations) {
    assert.notEqual(idempotencyKey(request, buildCallInput(request)), baseKey)
  }
  assert.notEqual(idempotencyKey(authorized, { ...baseInput, metadata: { app: 'one-more-story-v2' } }), baseKey)
})

test('live output summary never contains recipient, transcript, or story content', () => {
  const snapshot = {
    id: 'call_test',
    status: 'completed',
    structuredResult: {
      recipient: '+15555550123',
      transcript: 'private transcript',
      story_answer: 'private story',
    },
  }
  const serialized = JSON.stringify(summarizeCallSnapshot(snapshot))
  assert.deepEqual(summarizeCallSnapshot(snapshot), { id: 'call_test', status: 'completed', resultReceived: true })
  assert.doesNotMatch(serialized, /15555550123|private transcript|private story/)
})

test('a corrected story does not exist until correction and read-back are confirmed', () => {
  assert.deepEqual(applyCorrection('green leaves', 'green leaves'), { confirmed: false, correctedAnswer: null })
  assert.deepEqual(applyCorrection('green leaves', 'Mint leaves, not green leaves.'), { confirmed: true, correctedAnswer: 'mint leaves' })
  assert.equal(isConfirmedStory({ disclosure_acknowledged: 'yes', permission_to_continue: 'yes', story_answer: 'answer', correction: 'mint', readback_confirmed: 'unknown', deletion_requested: false }), false)
  assert.equal(isConfirmedStory({ disclosure_acknowledged: 'yes', permission_to_continue: 'yes', story_answer: 'answer', correction: 'mint', readback_confirmed: 'yes', deletion_requested: false }), true)
})
