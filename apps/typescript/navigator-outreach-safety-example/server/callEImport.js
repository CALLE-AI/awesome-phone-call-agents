import { CalleClient } from '@call-e/calle'
import { assertSafetyLock } from './safetyLock.js'

/**
 * Loads CALL-E at runtime after validating the permanent no-call lock.
 * It deliberately does not instantiate a client, read a credential, or make a network request.
 * @param {Record<string, string | undefined>} environment
 */
export function verifyCallEImport(environment) {
  const lock = assertSafetyLock(environment)
  return Object.freeze({
    packageImported: typeof CalleClient === 'function',
    networkRequestMade: false,
    telephoneCallAttempted: false,
    lock,
  })
}
