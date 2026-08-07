import { describe, it, expect } from 'vitest';
import {
  checkNotificationFreshness,
  MAX_NOTIFICATION_AGE_MINUTES,
} from '../lib/notification-freshness.js';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const minutesBefore = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const minutesAfter = (minutes) => new Date(NOW + minutes * 60000).toISOString();

describe('checkNotificationFreshness', () => {
  it('accepts a terminal result CALL-E published moments ago', () => {
    const check = checkNotificationFreshness({ completed_at: minutesBefore(0.5) }, NOW);
    expect(check.fresh).toBe(true);
    expect(check.reason).toBe(null);
  });

  it('accepts one published just inside the window', () => {
    const check = checkNotificationFreshness(
      { completed_at: minutesBefore(MAX_NOTIFICATION_AGE_MINUTES - 1) },
      NOW,
    );
    expect(check.fresh).toBe(true);
  });

  // The replay the maintainer described: a real call id, a real authoritative
  // result, POSTed again long after the call actually ended.
  it('rejects a result published long before the notification arrived', () => {
    const check = checkNotificationFreshness(
      { completed_at: minutesBefore(MAX_NOTIFICATION_AGE_MINUTES + 1) },
      NOW,
    );
    expect(check.fresh).toBe(false);
    expect(check.reason).toMatch(/minutes/);
  });

  it('rejects a result published hours ago', () => {
    const check = checkNotificationFreshness({ completed_at: minutesBefore(240) }, NOW);
    expect(check.fresh).toBe(false);
  });

  it('rejects a call CALL-E has not published a terminal result for', () => {
    const check = checkNotificationFreshness({ status: 'in_progress', completed_at: null }, NOW);
    expect(check.fresh).toBe(false);
    expect(check.reason).toMatch(/terminal/);
  });

  it('rejects a record with no completion timestamp at all', () => {
    const check = checkNotificationFreshness({ status: 'completed' }, NOW);
    expect(check.fresh).toBe(false);
  });

  it('rejects a completion timestamp that cannot be read as a date', () => {
    const check = checkNotificationFreshness({ completed_at: 'last Tuesday' }, NOW);
    expect(check.fresh).toBe(false);
    expect(check.reason).toMatch(/could not be read/);
  });

  // A clock a couple of minutes apart is ordinary; a result stamped an hour
  // into the future is not something freshness can be established from.
  it('tolerates a small clock difference between CALL-E and Zapier', () => {
    expect(checkNotificationFreshness({ completed_at: minutesAfter(1) }, NOW).fresh).toBe(true);
  });

  it('rejects a completion timestamp far in the future', () => {
    const check = checkNotificationFreshness({ completed_at: minutesAfter(60) }, NOW);
    expect(check.fresh).toBe(false);
    expect(check.reason).toMatch(/future/);
  });

  it('rejects an unreadable record rather than assuming it is fresh', () => {
    expect(checkNotificationFreshness(null, NOW).fresh).toBe(false);
    expect(checkNotificationFreshness('nope', NOW).fresh).toBe(false);
    expect(checkNotificationFreshness([], NOW).fresh).toBe(false);
  });

  it('always explains itself when it refuses', () => {
    const refusals = [
      checkNotificationFreshness(null, NOW),
      checkNotificationFreshness({ completed_at: null }, NOW),
      checkNotificationFreshness({ completed_at: 'nope' }, NOW),
      checkNotificationFreshness({ completed_at: minutesBefore(600) }, NOW),
      checkNotificationFreshness({ completed_at: minutesAfter(600) }, NOW),
    ];
    for (const refusal of refusals) {
      expect(refusal.fresh).toBe(false);
      expect(typeof refusal.reason).toBe('string');
      expect(refusal.reason.length).toBeGreaterThan(0);
    }
  });
});
