import { isLiveCallsEnabled, validateCalleBaseUrl, assertLiveCallsEnabled, isAuthorizedLiveRecipient, assertLiveCallDestinationAuthorized } from '../src/utils/liveCallGate';

const originalEnv = { ...process.env };

describe('Live Call Gate Utilities', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOW_LIVE_CALLS;
    delete process.env.CALLE_API_KEY;
    delete process.env.CALLE_API_KEY_SOURCE;
    delete process.env.ALLOWED_LIVE_RECIPIENTS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isLiveCallsEnabled', () => {
    it('returns false when ALLOW_LIVE_CALLS is not set', () => {
      expect(isLiveCallsEnabled()).toBe(false);
    });

    it('returns false when CALLE_API_KEY is not set', () => {
      process.env.ALLOW_LIVE_CALLS = 'true';
      expect(isLiveCallsEnabled()).toBe(false);
    });

    it('returns false when credential origin is unsupported', () => {
      process.env.ALLOW_LIVE_CALLS = 'true';
      process.env.CALLE_API_KEY = 'test_api_key';
      process.env.CALLE_API_KEY_SOURCE = 'request-body';
      expect(isLiveCallsEnabled()).toBe(false);
    });

    it('returns true when live switch, key, and approved origin are configured', () => {
      process.env.ALLOW_LIVE_CALLS = 'true';
      process.env.CALLE_API_KEY = 'test_api_key';
      process.env.CALLE_API_KEY_SOURCE = 'env';
      expect(isLiveCallsEnabled()).toBe(true);
    });
  });

  describe('authorized live recipients', () => {
    it('requires an exact E.164 destination in ALLOWED_LIVE_RECIPIENTS', () => {
      process.env.ALLOWED_LIVE_RECIPIENTS = '+14155552671,+442079460123';

      expect(isAuthorizedLiveRecipient('+14155552671')).toBe(true);
      expect(isAuthorizedLiveRecipient('+14155550000')).toBe(false);
    });

    it('throws when the destination is missing from the per-run allowlist', () => {
      process.env.ALLOWED_LIVE_RECIPIENTS = '+14155552671';

      expect(() => assertLiveCallDestinationAuthorized('+14155550000')).toThrow('not authorized');
    });
  });

  describe('validateCalleBaseUrl', () => {
    it('passes with valid HTTPS URL', () => {
      process.env.CALLE_BASE_URL = 'https://api.heycall-e.com';
      expect(() => validateCalleBaseUrl()).not.toThrow();
    });

    it('throws error for HTTP URL', () => {
      process.env.CALLE_BASE_URL = 'http://api.heycall-e.com';
      expect(() => validateCalleBaseUrl()).toThrow('HTTPS');
    });
  });

  describe('assertLiveCallsEnabled', () => {
    it('does not throw when live calls are enabled', () => {
      process.env.ALLOW_LIVE_CALLS = 'true';
      process.env.CALLE_API_KEY = 'test_key';
      process.env.CALLE_API_KEY_SOURCE = 'vault';
      expect(() => assertLiveCallsEnabled('Test context')).not.toThrow();
    });

    it('throws when live calls are not enabled', () => {
      process.env.ALLOW_LIVE_CALLS = 'false';
      process.env.CALLE_API_KEY = 'test_key';
      expect(() => assertLiveCallsEnabled('Test context')).toThrow('ALLOW_LIVE_CALLS=true');
    });
  });
});
