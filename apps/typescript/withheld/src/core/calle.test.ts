import { describe, expect, it } from 'vitest';
import { approvedBaseUrl, isObviouslyFakeKey } from './calle';

const LIVE = 'https://api.heycall-e.com';

/**
 * A misconfigured base URL is a silent credential leak: nothing fails, the key
 * is just gone. These pin the cases where the app must refuse rather than send.
 */
describe('approvedBaseUrl', () => {
  it('accepts the live origin over HTTPS', () => {
    expect(approvedBaseUrl(LIVE, 'sk-live-real')).toBe(LIVE);
    expect(approvedBaseUrl(`${LIVE}/`, 'sk-live-real')).toBe(LIVE);
  });

  it('refuses plaintext to the live host, naming the real reason', () => {
    expect(() => approvedBaseUrl('http://api.heycall-e.com', 'sk-live-real')).toThrow(
      /plaintext/i,
    );
  });

  it('refuses any other origin, however plausible', () => {
    for (const url of [
      'https://api.heycall-e.com.evil.test',
      'https://heycall-e.com',
      'https://api.example.com',
    ]) {
      expect(() => approvedBaseUrl(url, 'sk-live-real')).toThrow(/unapproved/i);
    }
  });

  it('refuses a URL carrying credentials, a query or a fragment', () => {
    expect(() => approvedBaseUrl('https://u:p@api.heycall-e.com', 'sk-live')).toThrow(
      /credentials or a query/i,
    );
    expect(() => approvedBaseUrl(`${LIVE}/?key=abc`, 'sk-live')).toThrow(
      /credentials or a query/i,
    );
    expect(() => approvedBaseUrl(`${LIVE}/#t`, 'sk-live')).toThrow(
      /credentials or a query/i,
    );
  });

  it('refuses a real-looking key sent to a loopback simulator', () => {
    for (const host of [
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'https://localhost:8080',
    ]) {
      expect(() => approvedBaseUrl(host, 'sk-live-real')).toThrow(
        /real-looking/i,
      );
    }
  });

  it('allows loopback only once the key announces itself as fake', () => {
    expect(approvedBaseUrl('http://localhost:8080', 'test-abc')).toBe(
      'http://localhost:8080',
    );
    expect(approvedBaseUrl('http://127.0.0.1:9000', 'FAKE_key')).toBe(
      'http://127.0.0.1:9000',
    );
  });

  it('refuses loopback when no key is supplied at all', () => {
    expect(() => approvedBaseUrl('http://localhost:8080')).toThrow(
      /real-looking/i,
    );
  });

  it('refuses a value that is not a URL', () => {
    expect(() => approvedBaseUrl('api.heycall-e.com', 'test-abc')).toThrow(
      /not a URL/i,
    );
  });
});

describe('isObviouslyFakeKey', () => {
  it('recognises keys that announce themselves', () => {
    for (const k of ['test-abc', 'fake_abc', 'DUMMY-1', 'sim-x', 'local_x']) {
      expect(isObviouslyFakeKey(k)).toBe(true);
    }
  });

  it('treats anything it is unsure about as real', () => {
    // The cost of guessing wrong is a live credential in the clear, so a key
    // that merely contains the word "test" is not good enough.
    for (const k of ['', 'sk-live-1', 'my-test-key', 'testing', 'attestation-x']) {
      expect(isObviouslyFakeKey(k)).toBe(false);
    }
  });
});
