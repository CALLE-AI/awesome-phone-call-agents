import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCompletedRun, completeFollowUp, demoPlan, demoResult, initialState } from '../src/workflow.js'

test('a completed call closes the loop across memory, metrics, timeline, and follow-up', () => {
  const next = applyCompletedRun(initialState, 'margaret', demoResult, demoPlan, 'call-proof', 'calle')
  const margaret = next.participants.find((participant) => participant.id === 'margaret')!

  assert.ok(margaret.memories.includes('The first balcony tomato turned red.'))
  assert.equal(margaret.tone, 'More connected')
  assert.match(margaret.next, /Friday/)
  assert.ok(next.timeline.some((item) => item.id === 'call-proof-memory'))
  assert.ok(next.timeline.some((item) => item.id === 'call-proof-scheduled'))
  assert.ok(next.followUps.some((item) => item.id === 'call-proof-follow-up' && item.status === 'open'))
  assert.ok(next.runs.some((run) => run.id === 'call-proof' && run.provider === 'calle'))
})

test('human follow-through can be completed without changing call history', () => {
  const before = applyCompletedRun(initialState, 'margaret', demoResult, demoPlan, 'call-close', 'demo')
  const after = completeFollowUp(before, 'call-close-follow-up')
  assert.equal(after.followUps.find((item) => item.id === 'call-close-follow-up')?.status, 'completed')
  assert.equal(after.runs.length, before.runs.length)
})
