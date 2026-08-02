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

const input = {
  task: 'Call the on-call engineer and get an acknowledgement.',
  phone: '+15550123456',
};

describe('start-call', () => {
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
  it('treats explicit negatives as a real call', () => {
    for (const value of [false, 'false', 'FALSE', 0, '0', '', '   ', null, undefined]) {
      expect(isDryRun(value)).toBe(false);
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
