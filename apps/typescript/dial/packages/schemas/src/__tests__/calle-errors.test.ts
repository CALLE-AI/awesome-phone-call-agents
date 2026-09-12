import { describe, it, expect } from 'vitest';
import {
  CALLE_ERROR_CODES,
  CALLE_ERROR_MESSAGES,
  RETRYABLE_CALLE_ERROR_CODES,
  describeCalleError,
} from '../calle.js';

/**
 * Every failure the calling service can report has to be sayable in English.
 *
 * Written after a real one slipped through. `call_not_ready` had no entry here,
 * so a call that failed showed "The call could not be completed" -- a sentence
 * that is true of every failure and useful for none of them. The provider's own
 * explanation was discarded at the same moment, so the only way to find out
 * what had happened was to probe the API by hand.
 */

const GENERIC = 'The call could not be completed.';

describe('CALL-E error messages', () => {
  it('says something specific about every code the API can return', () => {
    const unmapped = CALLE_ERROR_CODES.filter((code) => !CALLE_ERROR_MESSAGES[code]);
    expect(unmapped, `these codes would show "${GENERIC}"`).toEqual([]);
  });

  it('has no entries for codes that do not exist', () => {
    // A misspelled key is a mapping that silently never applies:
    // `recipient_schema_invalid` sat here while the real code was
    // `recipient_result_schema_invalid`.
    const unknown = Object.keys(CALLE_ERROR_MESSAGES).filter(
      (key) => !(CALLE_ERROR_CODES as readonly string[]).includes(key),
    );
    expect(unknown, 'these keys match no real error code').toEqual([]);
  });

  it('never renders a code as the generic sentence', () => {
    for (const code of CALLE_ERROR_CODES) {
      expect(describeCalleError(code), code).not.toBe(GENERIC);
    }
  });

  it('keeps the generic sentence for the case it is actually for', () => {
    // No code at all is the one situation where nothing more can be said.
    expect(describeCalleError(null)).toBe(GENERIC);
    expect(describeCalleError(undefined)).toBe(GENERIC);
  });

  it('prefers the caller’s fallback to the generic sentence', () => {
    expect(describeCalleError(null, 'Hung up after ringing out.')).toBe('Hung up after ringing out.');
  });

  it('says nothing about machinery', () => {
    // Section 36: a user must never be shown machine vocabulary.
    for (const code of CALLE_ERROR_CODES) {
      const message = describeCalleError(code);
      expect(message, code).not.toMatch(/[_{}]|\bnull\b|\bundefined\b|HTTP \d/);
      expect(message.endsWith('.'), `${code}: "${message}"`).toBe(true);
    }
  });
});

describe('which failures are worth retrying', () => {
  it('retries only codes that could succeed on a second attempt', () => {
    for (const code of RETRYABLE_CALLE_ERROR_CODES) {
      expect(CALLE_ERROR_CODES).toContain(code);
    }
  });

  it('retries a call the service was not ready to place', () => {
    // Nothing was dialled, so a retry costs a request and cannot double-call.
    expect(RETRYABLE_CALLE_ERROR_CODES).toContain('call_not_ready');
  });

  it('never retries a failure that would just ring a stranger again', () => {
    for (const code of [
      'invalid_phone',
      'invalid_recipient',
      'recipient_blocked',
      'policy_violation',
      'insufficient_balance',
      'unauthorized',
      'forbidden',
    ] as const) {
      expect(RETRYABLE_CALLE_ERROR_CODES, code).not.toContain(code);
    }
  });
});
