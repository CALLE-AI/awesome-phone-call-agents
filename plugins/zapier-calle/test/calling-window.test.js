import { describe, it, expect } from 'vitest';
import { checkCallingWindow, callingWindowOptionsFromInput } from '../lib/calling-window.js';

describe('checkCallingWindow', () => {
  it('allows a weekday well inside the window', () => {
    const now = new Date(Date.UTC(2026, 0, 14, 15, 0, 0)); // Wed 10:00 EST
    const result = checkCallingWindow({ timezone: 'America/New_York', now });
    expect(result.localHour).toBe(10);
    expect(result.localWeekday).toBe('Wed');
    expect(result.enforced).toBe(true);
    expect(result.allowed).toBe(true);
  });

  it('blocks 07:59 local and allows 08:00 local', () => {
    const before = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 14, 12, 59, 0)),
    });
    expect(before.localHour).toBe(7);
    expect(before.allowed).toBe(false);

    const atOpen = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 14, 13, 0, 0)),
    });
    expect(atOpen.localHour).toBe(8);
    expect(atOpen.allowed).toBe(true);
  });

  it('allows 20:59 local and blocks 21:00 local', () => {
    const beforeClose = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 15, 1, 59, 0)),
    });
    expect(beforeClose.localHour).toBe(20);
    expect(beforeClose.allowed).toBe(true);

    const atClose = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 15, 2, 0, 0)),
    });
    expect(atClose.localHour).toBe(21);
    expect(atClose.allowed).toBe(false);
  });

  it('lets the callee timezone govern - one instant, two verdicts', () => {
    const instant = new Date(Date.UTC(2026, 0, 14, 3, 0, 0));

    const hcm = checkCallingWindow({ timezone: 'Asia/Ho_Chi_Minh', now: instant });
    expect(hcm.localHour).toBe(10);
    expect(hcm.allowed).toBe(true);

    const ny = checkCallingWindow({ timezone: 'America/New_York', now: instant });
    expect(ny.localHour).toBe(22);
    expect(ny.allowed).toBe(false);
  });

  it('handles daylight saving correctly for the same wall-clock hour', () => {
    // Jan 14 2026, 10:00 EST (UTC-5)
    const januaryTenAm = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 14, 15, 0, 0)),
    });
    expect(januaryTenAm.localHour).toBe(10);
    expect(januaryTenAm.allowed).toBe(true);

    // Jul 14 2026, 10:00 EDT (UTC-4)
    const julyTenAm = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 6, 14, 14, 0, 0)),
    });
    expect(julyTenAm.localHour).toBe(10);
    expect(julyTenAm.allowed).toBe(true);
  });

  it('does not enforce when the timezone is missing or blank', () => {
    for (const timezone of [undefined, '', '   ']) {
      const result = checkCallingWindow({ timezone });
      expect(result.enforced).toBe(false);
      expect(result.allowed).toBe(true);
    }
  });

  it('fails closed on an invalid IANA name without throwing', () => {
    expect(() => checkCallingWindow({ timezone: 'Not/AZone' })).not.toThrow();
    const result = checkCallingWindow({ timezone: 'Not/AZone' });
    expect(result.enforced).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not a recognized IANA/i);
  });

  it('rejects a raw UTC offset instead of silently accepting it', () => {
    for (const timezone of ['+07:00', 'UTC+7', '-5']) {
      const result = checkCallingWindow({ timezone });
      expect(result.enforced).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/raw UTC offset/i);
    }
  });

  it('blockSunday blocks Sunday and permits Monday at the same local hour', () => {
    const sunday = checkCallingWindow({
      timezone: 'America/New_York',
      blockSunday: true,
      now: new Date(Date.UTC(2026, 0, 18, 15, 0, 0)), // Sun 10:00 EST
    });
    expect(sunday.localWeekday).toBe('Sun');
    expect(sunday.allowed).toBe(false);
    expect(sunday.reason).toMatch(/sunday/i);

    const monday = checkCallingWindow({
      timezone: 'America/New_York',
      blockSunday: true,
      now: new Date(Date.UTC(2026, 0, 19, 15, 0, 0)), // Mon 10:00 EST
    });
    expect(monday.localWeekday).toBe('Mon');
    expect(monday.allowed).toBe(true);
  });

  it('fails closed on invalid hour bounds', () => {
    const now = new Date(Date.UTC(2026, 0, 14, 15, 0, 0));
    const cases = [
      { earliestHour: 8.5, latestHour: 21 },
      { earliestHour: 25, latestHour: 21 },
      { earliestHour: -1, latestHour: 21 },
      { earliestHour: 21, latestHour: 8 },
      { earliestHour: 9, latestHour: 9 },
    ];
    for (const bounds of cases) {
      const result = checkCallingWindow({ timezone: 'America/New_York', now, ...bounds });
      expect(result.enforced).toBe(true);
      expect(result.allowed).toBe(false);
    }
  });

  it('normalizes midnight to local hour 0, not 24', () => {
    const result = checkCallingWindow({
      timezone: 'America/New_York',
      now: new Date(Date.UTC(2026, 0, 14, 5, 0, 0)), // 00:00 EST
    });
    expect(result.localHour).toBe(0);
    expect(result.allowed).toBe(false);
  });
});

describe('callingWindowOptionsFromInput', () => {
  it('reads the four calling_window_* inputs', () => {
    expect(
      callingWindowOptionsFromInput({
        calling_window_timezone: 'America/New_York',
        calling_window_earliest_hour: '9',
        calling_window_latest_hour: '20',
        calling_window_block_sunday: 'true',
      }),
    ).toEqual({
      timezone: 'America/New_York',
      earliestHour: 9,
      latestHour: 20,
      blockSunday: true,
    });
  });

  it('falls back to the TCPA defaults when the hours are absent', () => {
    const options = callingWindowOptionsFromInput({});
    expect(options.earliestHour).toBe(8);
    expect(options.latestHour).toBe(21);
  });

  // Regression: Number([]) is 0, so a mapped Zapier line-item field arriving
  // as an array used to widen the earliest hour to midnight instead of
  // falling back to 8. A non-scalar input must never loosen the window.
  it('does not let a non-scalar input widen the window', () => {
    for (const value of [[], {}, true, 'not a number']) {
      const options = callingWindowOptionsFromInput({
        calling_window_earliest_hour: value,
        calling_window_latest_hour: value,
      });
      expect(options.earliestHour).toBe(8);
      expect(options.latestHour).toBe(21);
    }
  });
});
