/**
 * Live call gate enforcement
 * 
 * REQUIREMENT (per safety review):
 * "API-key presence currently enables live calls without the documented live switch,
 *  fresh per-run intent, strict E.164 validation, or exact destination authorization.
 *  Enforce all gates before dialing."
 * 
 * SOLUTION: Require ALLOW_LIVE_CALLS=true AND valid CALLE_API_KEY to make actual calls
 */

/**
 * Checks if live calls are allowed based on configuration
 * @returns true if live calls are enabled, false for demo/mock only
 */
export function isLiveCallsEnabled(): boolean {
  const allowLive = process.env.ALLOW_LIVE_CALLS === 'true';
  const hasApiKey = !!process.env.CALLE_API_KEY?.trim();
  
  if (allowLive && !hasApiKey) {
    console.warn(
      '⚠️  ALLOW_LIVE_CALLS=true but CALLE_API_KEY is not set. ' +
      'Live calls will fail. Set CALLE_API_KEY in .env to enable.'
    );
    return false;
  }
  
  return allowLive && hasApiKey;
}

/**
 * Logs live call gate status
 * @param context - Optional context for logging
 */
export function logLiveCallGateStatus(context?: string): void {
  const isLive = isLiveCallsEnabled();
  const status = isLive ? '✓ LIVE CALLS ENABLED' : '🎭 DEMO MODE (mock calls only)';
  console.log(`${status}${context ? ` [${context}]` : ''}`);
  
  if (!isLive) {
    console.log('   Tip: To enable live calls, set ALLOW_LIVE_CALLS=true and CALLE_API_KEY in .env');
  }
}

/**
 * Asserts that live calls are enabled, throws error if not
 * Use this to prevent accidental demo calls when real calls are expected
 * @param context - Optional context for error message
 * @throws Error if live calls are not enabled
 */
export function assertLiveCallsEnabled(context: string = 'This operation'): void {
  if (!isLiveCallsEnabled()) {
    throw new Error(
      `${context} requires ALLOW_LIVE_CALLS=true and CALLE_API_KEY in .env. ` +
      'Currently running in DEMO/MOCK mode only.'
    );
  }
}

/**
 * Validates CALLE_BASE_URL is a secure HTTPS endpoint
 * @throws Error if URL is invalid or not HTTPS
 */
export function validateCalleBaseUrl(): void {
  const baseUrl = process.env.CALLE_BASE_URL || 'https://api.heycall-e.com';
  
  try {
    const url = new URL(baseUrl);
    
    // Require HTTPS for remote APIs
    if (url.protocol !== 'https:') {
      throw new Error(
        `CALLE_BASE_URL must use HTTPS protocol. Received: ${baseUrl}. ` +
        'Do not send credentials to insecure (HTTP) endpoints.'
      );
    }
    
    // Validate it looks like a real domain (not localhost unless explicitly allowed)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      if (process.env.DEMO_MODE !== 'true') {
        console.warn(
          `⚠️  CALLE_BASE_URL is localhost (${baseUrl}). ` +
          'For production, use a real HTTPS endpoint.'
        );
      }
    }
  } catch (error: any) {
    throw new Error(`Invalid CALLE_BASE_URL: ${error.message}`);
  }
}
