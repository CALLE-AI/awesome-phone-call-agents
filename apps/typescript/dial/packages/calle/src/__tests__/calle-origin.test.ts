import { describe, it, expect } from 'vitest';
import { checkCalleOrigin } from '@dial/config';
import { CalleCallProvider } from '../calle-provider.js';

/**
 * The API key is a paid-account bearer credential, so the origin it is sent to
 * is a security boundary rather than a preference. These cover the boundary
 * itself and the last point before the key is attached to a request.
 */

describe('checkCalleOrigin', () => {
  it('accepts the CALL-E API host and its subdomains over https', () => {
    expect(checkCalleOrigin('https://api.heycall-e.com').ok).toBe(true);
    expect(checkCalleOrigin('https://staging.heycall-e.com').ok).toBe(true);
  });

  it('refuses plaintext, so the key is never sent in clear text', () => {
    expect(checkCalleOrigin('http://api.heycall-e.com').ok).toBe(false);
  });

  it('refuses any host that is not CALL-E', () => {
    expect(checkCalleOrigin('https://evil.example').ok).toBe(false);
    // A lookalike must not pass by ending in the approved suffix.
    expect(checkCalleOrigin('https://heycall-e.com.evil.example').ok).toBe(false);
    expect(checkCalleOrigin('https://api-heycall-e.com').ok).toBe(false);
  });

  it('refuses a value that is not a URL at all', () => {
    expect(checkCalleOrigin('api.heycall-e.com').ok).toBe(false);
    expect(checkCalleOrigin('').ok).toBe(false);
  });
});

describe('CalleCallProvider', () => {
  it('refuses to be built with an unapproved origin', () => {
    // `calle:verify` constructs a provider straight from the environment and
    // never runs loadConfig, so the check has to live here too.
    expect(() => new CalleCallProvider('local-dummy-key', 'https://evil.example')).toThrow(
      /unapproved origin/i,
    );
  });

  it('still refuses to be built without a key', () => {
    expect(() => new CalleCallProvider('', 'https://api.heycall-e.com')).toThrow(/API key/i);
  });
});
