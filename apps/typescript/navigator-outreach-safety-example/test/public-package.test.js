import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyCallEImport } from '../server/callEImport.js'
import { runMockGuard } from '../server/mockGuard.js'
import { assertSafetyLock } from '../server/safetyLock.js'

const locked = Object.freeze({
  CALL_EXECUTION_ENABLED: 'false',
  CONTROLLED_CALL_GO: 'false',
  MAXIMUM_CALLS: '0',
  SHUTDOWN_ACTIVE: 'true',
})

test('CALL-E is imported at runtime with execution locked', () => {
  const result = verifyCallEImport(locked)
  assert.equal(result.packageImported, true)
  assert.equal(result.networkRequestMade, false)
  assert.equal(result.telephoneCallAttempted, false)
  assert.deepEqual(result.lock, { executionEnabled: false, goEnabled: false, maximumCalls: 0, shutdownActive: true })
})

test('mock guard remains local and no-call', () => {
  assert.deepEqual(runMockGuard(locked), {
    mode: 'mock-only', fixture: 'FICTIONAL-OUTREACH-001', externalConnectionUsed: false,
    telephoneCallAttempted: false, lock: { executionEnabled: false, goEnabled: false, maximumCalls: 0, shutdownActive: true },
  })
})

/** @type {Array<[string, Record<string, string>]>} */
const rejectedChanges = [
  ['execution enabled', { CALL_EXECUTION_ENABLED: 'true' }],
  ['GO enabled', { CONTROLLED_CALL_GO: 'true' }],
  ['one-call ceiling', { MAXIMUM_CALLS: '1' }],
  ['shutdown inactive', { SHUTDOWN_ACTIVE: 'false' }],
  ['credential supplied', { CALLE_API_KEY: 'not-a-real-key' }],
]

for (const [name, change] of rejectedChanges) {
  test(`safety lock rejects ${name}`, () => {
    assert.throws(() => assertSafetyLock({ ...locked, ...change }))
  })
}
