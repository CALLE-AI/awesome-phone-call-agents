import { describe, it, expect } from 'vitest';
import { detectOptOut } from '../lib/opt-out.js';

const withTurns = (turns) => [{ attempts: [{ transcript_turns: turns }] }];
const userSaid = (text, offset = 5) => withTurns([{ offset_seconds: offset, speaker: 'user', text }]);

describe('detectOptOut', () => {
  it('detects the common phrasings', () => {
    const phrases = [
      'Please stop calling me.',
      'Stop contacting me at this number.',
      'Quit calling.',
      'Do not call me again.',
      "Don't call me anymore.",
      'Never call me again please.',
      'No more calls, thanks.',
      'Take me off your list.',
      'Remove me from your database.',
      'Please remove my number.',
      'Delete my number from your system.',
      'I want to unsubscribe.',
      'I would like to opt out.',
      'Opt me out.',
    ];
    for (const phrase of phrases) {
      expect(detectOptOut(userSaid(phrase)).requested, phrase).toBe(true);
    }
  });

  it('matches through casing, punctuation, and the apostrophe in "dont"', () => {
    expect(detectOptOut(userSaid('DON’T CALL ME!!!')).requested).toBe(true);
    expect(detectOptOut(userSaid('stop   calling')).requested).toBe(true);
  });

  it('returns the quote and its offset so a human can find it', () => {
    const result = detectOptOut(userSaid('Yeah, no. Take me off your list.', 42));
    expect(result.excerpt).toBe('Yeah, no. Take me off your list.');
    expect(result.offsetSeconds).toBe(42);
    expect(result.matchedPhrase).toBe('take me off');
  });

  // State bot-disclosure laws push callers to read an opt-out offer aloud, so
  // the bot's own script routinely contains this exact language. Scanning it
  // would flag every compliant call.
  it('ignores the bot reading its own opt-out disclosure', () => {
    const turns = withTurns([
      { offset_seconds: 1, speaker: 'bot', text: "Say stop calling and we won't call again." },
      { offset_seconds: 9, speaker: 'user', text: 'Sure, Thursday works.' },
    ]);
    expect(detectOptOut(turns).requested).toBe(false);
  });

  it('does not fire on ordinary conversation', () => {
    for (const text of ['Yes, that works.', 'Can you call the office instead?', 'I will call you back.']) {
      expect(detectOptOut(userSaid(text)).requested, text).toBe(false);
    }
  });

  it('reports the first request when several turns qualify', () => {
    const turns = withTurns([
      { offset_seconds: 4, speaker: 'user', text: 'Stop calling me.' },
      { offset_seconds: 20, speaker: 'user', text: 'Remove my number.' },
    ]);
    expect(detectOptOut(turns).offsetSeconds).toBe(4);
  });

  it('caps a very long turn rather than echoing it whole', () => {
    const result = detectOptOut(userSaid(`stop calling ${'x'.repeat(600)}`));
    expect(result.excerpt.length).toBeLessThanOrEqual(303);
  });

  it('handles a missing offset without inventing one', () => {
    const turns = withTurns([{ speaker: 'user', text: 'stop calling' }]);
    expect(detectOptOut(turns).offsetSeconds).toBeNull();
  });

  // An unreadable transcript is not evidence of a revocation. Flagging every
  // malformed payload would train users to ignore the flag.
  it('reports no request for malformed input rather than guessing', () => {
    for (const value of [null, undefined, [], 'not an array', 42, [{}], [{ attempts: null }]]) {
      expect(detectOptOut(value).requested).toBe(false);
    }
  });

  it('does not throw when a turn has a hostile accessor', () => {
    const turn = { speaker: 'user' };
    Object.defineProperty(turn, 'text', {
      get() { throw new Error('boom'); },
      enumerable: true,
    });
    expect(() => detectOptOut(withTurns([turn]))).not.toThrow();
    expect(detectOptOut(withTurns([turn])).requested).toBe(false);
  });
});
