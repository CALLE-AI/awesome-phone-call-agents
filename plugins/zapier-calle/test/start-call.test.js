import { describe, it, expect, afterEach } from 'vitest';
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
