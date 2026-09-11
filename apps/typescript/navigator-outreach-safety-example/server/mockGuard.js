import { assertSafetyLock } from './safetyLock.js'

/**
 * Mock-only guard: it reports a fictional result without accepting a recipient,
 * credential, URL, or transport. It is intentionally not a CALL-E API wrapper.
 * @param {Record<string, string | undefined>} environment
 */
export function runMockGuard(environment) {
  const lock = assertSafetyLock(environment)
  return Object.freeze({
    mode: 'mock-only',
    fixture: 'FICTIONAL-OUTREACH-001',
    externalConnectionUsed: false,
    telephoneCallAttempted: false,
    lock,
  })
}
