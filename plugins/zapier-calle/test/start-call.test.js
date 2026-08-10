import { describe, it, expect, afterEach, vi } from 'vitest';
import { startFakeCalle } from './fake-calle-server.js';
import startCall from '../creates/start-call.js';
import { isDryRun } from '../lib/build-payload.js';

let server;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const zFor = (apiKey = 'k') => ({
  request: async (options) => {
    const response = await fetch(options.url, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  },
});

const bundleFor = (server, inputData) => ({
  authData: { apiKey: 'k', baseUrl: server.url },
  inputData,
});

// Dialing is opt-in: every test below that expects a real request has to say
// so, exactly as a user does. Omitting the field is covered on its own.
const input = {
  task: 'Call the on-call engineer and get an acknowledgement.',
  phone: '+15550123456',
  dry_run: false,
};

describe('start-call', () => {
  it('places no call when dry_run was never set', async () => {
    server = await startFakeCalle({});
    const { dry_run: _omitted, ...withoutDryRun } = input;
    const output = await startCall.operation.perform(zFor(), bundleFor(server, withoutDryRun));

    expect(output.dry_run).toBe(true);
    expect(output.call_id).toBe(null);
    expect(server.lastRequest()).toBe(null);
  });

  it('places no call when dry_run maps to an empty value', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(zFor(), bundleFor(server, { ...input, dry_run: '' }));

    expect(output.dry_run).toBe(true);
    expect(server.lastRequest()).toBe(null);
  });

  it('creates a call and returns the call id', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(zFor(), bundleFor(server, input));

    expect(output.call_id).toMatch(/^call_/);
    expect(output.disposition).toBe('outcome_unknown');
    expect(server.lastRequest().path).toBe('/v1/calls');
    expect(server.lastRequest().headers['idempotency-key']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('places no call in dry-run mode and masks the phone', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, dry_run: true }),
    );

    expect(output.dry_run).toBe(true);
    expect(output.call_id).toBe(null);
    expect(JSON.stringify(output.preview)).toContain('+1******3456');
    expect(JSON.stringify(output.preview)).not.toContain('0123456');
    expect(server.lastRequest()).toBe(null);
  });

  it('throws before dialing when the phone is not E.164', async () => {
    server = await startFakeCalle({});
    await expect(
      startCall.operation.perform(zFor(), bundleFor(server, { ...input, phone: '5550123' })),
    ).rejects.toThrow(/E\.164/);
    expect(server.lastRequest()).toBe(null);
  });

  it('does not place a call for an ambiguous dry_run value', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, dry_run: 'TRUE' }),
    );
    expect(output.dry_run).toBe(true);
    expect(server.lastRequest()).toBe(null);
  });

  it('refuses to dial outside the configured calling window and makes no request', async () => {
    server = await startFakeCalle({});
    // Fixed instant: 03:00 UTC is 22:00 EST the prior day - outside 8-21.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 3, 0, 0)));
    try {
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, {
          ...input,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        }),
      );

      expect(output.disposition).toBe('outside_calling_window');
      expect(output.is_actionable).toBe(false);
      expect(output.call_id).toBe(null);
      expect(server.lastRequest()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('previews outside the configured calling window when dry_run is true', async () => {
    server = await startFakeCalle({});
    // Fixed instant: 03:00 UTC is 22:00 EST the prior day - outside 8-21.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 3, 0, 0)));
    try {
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, {
          ...input,
          dry_run: true,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        }),
      );

      expect(output.dry_run).toBe(true);
      expect(output.call_id).toBe(null);
      expect(output.preview).toBeDefined();
      expect(output.calling_window.enforced).toBe(true);
      expect(output.calling_window.allowed).toBe(false);
      expect(server.lastRequest()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the calling window as allowed on a dry run made inside the window', async () => {
    server = await startFakeCalle({});
    // Same fixture, shifted to 15:00 UTC = 10:00 EST - inside 8-21.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 15, 0, 0)));
    try {
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, {
          ...input,
          dry_run: true,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        }),
      );

      expect(output.dry_run).toBe(true);
      expect(output.calling_window.allowed).toBe(true);
      expect(server.lastRequest()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the calling window as not enforced on a dry run with no timezone', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, dry_run: true }),
    );

    expect(output.dry_run).toBe(true);
    expect(output.calling_window.enforced).toBe(false);
    expect(output.calling_window.allowed).toBe(true);
  });

  describe('retry policy', () => {
    const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

    it('refuses to dial once the daily cap is reached and makes no request', async () => {
      server = await startFakeCalle({});
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, { ...input, previous_attempts: [hoursAgo(20), hoursAgo(6)].join(',') }),
      );

      expect(output.disposition).toBe('retry_policy_blocked');
      expect(output.lead_state).toBe('blocked_compliance');
      expect(output.retry_policy_enforced).toBe(true);
      expect(output.attempts_in_last_day).toBe(2);
      expect(server.lastRequest()).toBeNull();
    });

    it('refuses when the last attempt is too recent', async () => {
      server = await startFakeCalle({});
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, { ...input, previous_attempts: hoursAgo(1) }),
      );
      expect(output.disposition).toBe('retry_policy_blocked');
      expect(server.lastRequest()).toBeNull();
    });

    it('dials when no history is supplied, preserving prior behavior', async () => {
      server = await startFakeCalle({});
      const output = await startCall.operation.perform(zFor(), bundleFor(server, input));
      expect(output.call_id).toMatch(/^call_/);
    });

    // Like the calling window and unlike suppression, this guard is about
    // timing, so a dry run previews its verdict instead of being blocked by
    // it - otherwise a Zap could not be inspected after a recent attempt.
    it('previews its verdict on a dry run rather than blocking the preview', async () => {
      server = await startFakeCalle({});
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, { ...input, dry_run: true, previous_attempts: hoursAgo(1) }),
      );

      expect(output.dry_run).toBe(true);
      expect(output.retry_policy.enforced).toBe(true);
      expect(output.retry_policy.allowed).toBe(false);
      expect(server.lastRequest()).toBeNull();
    });
  });

  it('refuses to dial a number on the suppression list and makes no request', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, suppression_list: '+15550123456' }),
    );

    expect(output.disposition).toBe('suppressed');
    expect(output.is_actionable).toBe(false);
    expect(output.call_id).toBe(null);
    expect(output.suppression_enforced).toBe(true);
    expect(output.matched_entry).not.toContain('5550123456');
    expect(server.lastRequest()).toBe(null);
  });

  it('refuses to preview a suppressed number even on a dry run', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, dry_run: true, suppression_list: '+15550123456' }),
    );

    expect(output.dry_run).toBe(true);
    expect(output.disposition).toBe('suppressed');
    expect(output.is_actionable).toBe(false);
    expect(output.call_id).toBe(null);
    expect(output.preview).toBeUndefined();
    expect(server.lastRequest()).toBe(null);
  });

  it('places the call normally when the suppression list does not match', async () => {
    server = await startFakeCalle({});
    const output = await startCall.operation.perform(
      zFor(),
      bundleFor(server, { ...input, suppression_list: '+15550199999' }),
    );

    expect(output.disposition).toBe('outcome_unknown');
    expect(output.call_id).toMatch(/^call_/);
    expect(server.lastRequest().path).toBe('/v1/calls');
  });

  it('places the call normally when inside the configured calling window', async () => {
    server = await startFakeCalle({});
    // Same fixture, shifted to 15:00 UTC = 10:00 EST - inside 8-21.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 15, 0, 0)));
    try {
      const output = await startCall.operation.perform(
        zFor(),
        bundleFor(server, {
          ...input,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        }),
      );

      expect(output.disposition).toBe('outcome_unknown');
      expect(output.call_id).toMatch(/^call_/);
      expect(server.lastRequest().path).toBe('/v1/calls');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isDryRun', () => {
  it('places a real call only for an explicit negative', () => {
    for (const value of [false, 'false', 'FALSE', ' false ', 0, '0']) {
      expect(isDryRun(value)).toBe(false);
    }
  });

  // The whole point of the default: a Zap nobody has switched to live yet, a
  // mapped field that resolved to nothing, an input that did not exist when
  // the Zap was built - none of them may dial a real person.
  it('treats an absent or blank value as a dry run rather than as permission to dial', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(isDryRun(value)).toBe(true);
    }
  });

  it('treats affirmative values as a dry run', () => {
    for (const value of [true, 'true', 'TRUE', 'True', 'yes', 'Y', 'on', '1', 1]) {
      expect(isDryRun(value)).toBe(true);
    }
  });

  it('treats unrecognized values as a dry run so no unintended call is placed', () => {
    for (const value of ['maybe', 'nope!', {}, [], 42, 'undefined']) {
      expect(isDryRun(value)).toBe(true);
    }
  });
});

describe('the Dry Run input field', () => {
  const dryRunField = startCall.operation.inputFields.find((f) => f.key === 'dry_run');

  it('ships switched on, so a newly configured action previews instead of calling', () => {
    expect(dryRunField.default).toBe('true');
    expect(isDryRun(dryRunField.default)).toBe(true);
  });
});
