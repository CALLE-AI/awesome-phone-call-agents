/**
 * Live call gate enforcement.
 *
 * Real outbound calls require all of the following:
 * - ALLOW_LIVE_CALLS=true
 * - CALLE_API_KEY configured from an approved secure origin
 * - Exact per-run E.164 destination authorization in ALLOWED_LIVE_RECIPIENTS
 */

import { isValidE164, validateE164OrThrow } from './phoneValidation';

const APPROVED_CREDENTIAL_ORIGINS = new Set(['env', 'secret-manager', 'vault']);

export function getCalleCredentialOrigin(): string {
  if (!process.env.CALLE_API_KEY?.trim()) return 'missing';
  return (process.env.CALLE_API_KEY_SOURCE || 'env').trim().toLowerCase();
}

export function isApprovedCredentialOrigin(): boolean {
  return APPROVED_CREDENTIAL_ORIGINS.has(getCalleCredentialOrigin());
}

export function isLiveCallsEnabled(): boolean {
  const allowLive = process.env.ALLOW_LIVE_CALLS === 'true';
  const hasApiKey = !!process.env.CALLE_API_KEY?.trim();

  if (allowLive && !hasApiKey) {
    console.warn('ALLOW_LIVE_CALLS=true but CALLE_API_KEY is not set. Live calls remain disabled.');
    return false;
  }

  if (allowLive && hasApiKey && !isApprovedCredentialOrigin()) {
    console.warn('Live calls disabled: CALLE_API_KEY_SOURCE must be env, secret-manager, or vault.');
    return false;
  }

  return allowLive && hasApiKey && isApprovedCredentialOrigin();
}

export function getAuthorizedLiveRecipients(): string[] {
  return (process.env.ALLOWED_LIVE_RECIPIENTS || '')
    .split(',')
    .map((phone) => phone.trim())
    .filter((phone) => phone.length > 0);
}

export function isAuthorizedLiveRecipient(phoneNumber: string): boolean {
  const normalized = validateE164OrThrow(phoneNumber, 'Destination phone number');
  return getAuthorizedLiveRecipients().some((allowed) => allowed === normalized && isValidE164(allowed));
}

export function assertLiveCallDestinationAuthorized(phoneNumber: string): string {
  const normalized = validateE164OrThrow(phoneNumber, 'Destination phone number');
  if (!isAuthorizedLiveRecipient(normalized)) {
    throw new Error(
      'Destination phone number is not authorized for this run. Add the exact E.164 number to ALLOWED_LIVE_RECIPIENTS.'
    );
  }
  return normalized;
}

export function logLiveCallGateStatus(context?: string): void {
  const isLive = isLiveCallsEnabled();
  const status = isLive ? 'LIVE CALLS ENABLED' : 'DEMO MODE (mock calls only)';
  console.log(`${status}${context ? ` [${context}]` : ''}`);

  if (!isLive) {
    console.log('   Tip: set ALLOW_LIVE_CALLS=true, CALLE_API_KEY, CALLE_API_KEY_SOURCE, and ALLOWED_LIVE_RECIPIENTS.');
  }
}

export function assertLiveCallsEnabled(context: string = 'This operation'): void {
  if (!isLiveCallsEnabled()) {
    throw new Error(
      `${context} requires ALLOW_LIVE_CALLS=true, CALLE_API_KEY from an approved origin, and authorized E.164 recipients.`
    );
  }
}

export function validateCalleBaseUrl(): void {
  const baseUrl = process.env.CALLE_BASE_URL || 'https://api.heycall-e.com';

  try {
    const url = new URL(baseUrl);

    if (url.protocol !== 'https:') {
      throw new Error(
        `CALLE_BASE_URL must use HTTPS protocol. Received: ${baseUrl}. Do not send credentials to insecure endpoints.`
      );
    }

    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && process.env.DEMO_MODE !== 'true') {
      console.warn(`CALLE_BASE_URL is localhost (${baseUrl}). For production, use a real HTTPS endpoint.`);
    }
  } catch (error: any) {
    throw new Error(`Invalid CALLE_BASE_URL: ${error.message}`);
  }
}
