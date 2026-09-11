/** @typedef {Record<string, string | undefined>} Environment */

/**
 * Validates the public example's fail-closed state. This package contains no
 * dispatch function and has no code path that creates, schedules, or starts a call.
 * @param {Environment} environment
 */
export function assertSafetyLock(environment) {
  const failures = []
  if (environment.CALL_EXECUTION_ENABLED !== 'false') failures.push('execution must be disabled')
  if (environment.CONTROLLED_CALL_GO !== 'false') failures.push('GO must be disabled')
  if (environment.MAXIMUM_CALLS !== '0') failures.push('maximum calls must be zero')
  if (environment.SHUTDOWN_ACTIVE !== 'true') failures.push('shutdown must be active')
  if (environment.CALLE_API_KEY) failures.push('credentials are not accepted by the public example')
  if (failures.length) throw new Error(failures.join('; '))
  return Object.freeze({ executionEnabled: false, goEnabled: false, maximumCalls: 0, shutdownActive: true })
}
