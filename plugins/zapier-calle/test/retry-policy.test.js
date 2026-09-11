import { describe, it, expect } from 'vitest';
import { checkRetryPolicy, retryPolicyOptionsFromInput } from '../lib/retry-policy.js';

const NOW = new Date('2026-08-05T18:00:00Z');
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();

describe('checkRetryPolicy', () => {
  it('does not enforce when no history was supplied', () => {
    for (const value of [undefined, null, '', '   ']) {
      const result = checkRetryPolicy({ previousAttempts: value, now: NOW });
      expect(result.enforced).toBe(false);
      expect(result.allowed).toBe(true);
    }
  });

  it('allows a call when the history is old enough and sparse enough', () => {
    const result = checkRetryPolicy({ previousAttempts: hoursAgo(30), now: NOW });
    expect(result.enforced).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.attemptsInLastDay).toBe(0);
  });

  it('refuses once the daily cap is reached', () => {
    const result = checkRetryPolicy({
      previousAttempts: [hoursAgo(20), hoursAgo(6)].join('\n'),
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.attemptsInLastDay).toBe(2);
    expect(result.reason).toContain('2 per day');
  });

  it('refuses when the last attempt is too recent even if the cap is not reached', () => {
    const result = checkRetryPolicy({ previousAttempts: hoursAgo(1), now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('1.0 hours ago');
  });

  it('counts only attempts inside the last 24 hours', () => {
    const result = checkRetryPolicy({
      previousAttempts: [hoursAgo(40), hoursAgo(30), hoursAgo(25), hoursAgo(10)].join(','),
      now: NOW,
    });
    expect(result.attemptsInLastDay).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it('accepts commas, semicolons, and newlines as separators', () => {
    const result = checkRetryPolicy({
      previousAttempts: `${hoursAgo(20)}, ${hoursAgo(19)};\n${hoursAgo(18)}`,
      now: NOW,
    });
    expect(result.attemptsInLastDay).toBe(3);
    expect(result.allowed).toBe(false);
  });

  it('honors caller-supplied limits', () => {
    const loose = checkRetryPolicy({
      previousAttempts: [hoursAgo(20), hoursAgo(6)].join(','),
      maxAttemptsPerDay: 5,
      minHoursBetweenAttempts: 1,
      now: NOW,
    });
    expect(loose.allowed).toBe(true);

    const strict = checkRetryPolicy({
      previousAttempts: hoursAgo(30),
      maxAttemptsPerDay: 1,
      minHoursBetweenAttempts: 48,
      now: NOW,
    });
    expect(strict.allowed).toBe(false);
  });

  describe('fails closed', () => {
    it('refuses when a timestamp cannot be parsed', () => {
      const result = checkRetryPolicy({ previousAttempts: 'last tuesday', now: NOW });
      expect(result.enforced).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('unparseable');
    });

    it('refuses when one entry in an otherwise valid list is bad', () => {
      const result = checkRetryPolicy({
        previousAttempts: `${hoursAgo(30)}, whenever`,
        now: NOW,
      });
      expect(result.allowed).toBe(false);
    });

    it('refuses when the history is not text', () => {
      for (const value of [42, {}, [], true]) {
        expect(checkRetryPolicy({ previousAttempts: value, now: NOW }).allowed).toBe(false);
      }
    });

    it('refuses a future-dated attempt rather than trusting the count', () => {
      const result = checkRetryPolicy({ previousAttempts: hoursAgo(-5), now: NOW });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('future');
    });

    it('refuses when the limits themselves are nonsense', () => {
      for (const limits of [
        { maxAttemptsPerDay: 0 },
        { maxAttemptsPerDay: -1 },
        { maxAttemptsPerDay: NaN },
        { minHoursBetweenAttempts: -4 },
        { minHoursBetweenAttempts: NaN },
      ]) {
        const result = checkRetryPolicy({ previousAttempts: hoursAgo(30), now: NOW, ...limits });
        expect(result.allowed).toBe(false);
      }
    });

    it('refuses when the current time is unusable', () => {
      expect(checkRetryPolicy({ previousAttempts: hoursAgo(30), now: 'nonsense' }).allowed)
        .toBe(false);
    });
  });
});

describe('retryPolicyOptionsFromInput', () => {
  it('reads the three retry_* inputs', () => {
    expect(
      retryPolicyOptionsFromInput({
        previous_attempts: '2026-08-05T10:00:00Z',
        retry_max_attempts_per_day: '3',
        retry_min_hours_between_attempts: '6',
      }),
    ).toEqual({
      previousAttempts: '2026-08-05T10:00:00Z',
      maxAttemptsPerDay: 3,
      minHoursBetweenAttempts: 6,
    });
  });

  it('falls back to the conservative defaults, including for non-scalar input', () => {
    for (const value of [undefined, '', [], {}, 'lots']) {
      const options = retryPolicyOptionsFromInput({
        retry_max_attempts_per_day: value,
        retry_min_hours_between_attempts: value,
      });
      expect(options.maxAttemptsPerDay).toBe(2);
      expect(options.minHoursBetweenAttempts).toBe(4);
    }
  });
});
