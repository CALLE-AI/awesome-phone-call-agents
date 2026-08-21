import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/runs/route';
import { idempotencyKey, validateLiveRunInput } from '../src/lib/validation';

function validBody() {
  return {
    runId: 'run-12345678',
    liveConfirmed: true,
    plan: {
      companyName: 'Northstar Concrete',
      projectName: 'Harbour Point',
      location: 'Tuas South',
      scheduledDate: '2026-09-03',
      scheduledTime: '06:30',
      volumeM3: '85',
      mixReference: 'C40 / P-217',
      region: 'SG',
    },
    contacts: [
      { role: 'site_supervisor', name: 'A', phone: '+6581234567' },
      { role: 'ready_mix_dispatch', name: 'B', phone: '+6581234568' },
      { role: 'pump_operator', name: 'C', phone: '+6581234569' },
      { role: 'testing_coordinator', name: 'D', phone: '+6581234570' },
    ],
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const originalLiveFlag = process.env.ENABLE_LIVE_CALLS;

afterEach(() => {
  if (originalLiveFlag === undefined) {
    delete process.env.ENABLE_LIVE_CALLS;
  } else {
    process.env.ENABLE_LIVE_CALLS = originalLiveFlag;
  }
});

describe('live-run validation', () => {
  it('rejects invalid E.164 numbers', () => {
    const body = validBody();
    body.contacts[0].phone = '8123 4567';
    expect(() => validateLiveRunInput(body)).toThrow('E.164');
  });

  it('rejects phone numbers outside the project region', () => {
    const body = validBody();
    body.contacts[0].phone = '+61412345678';
    expect(() => validateLiveRunInput(body)).toThrow('SG project region');
  });

  it('rejects unsupported regions', () => {
    const body = validBody();
    body.plan.region = 'US';
    expect(() => validateLiveRunInput(body)).toThrow('AU or SG');
  });

  it('requires explicit live confirmation', () => {
    const body = validBody();
    body.liveConfirmed = false;
    expect(() => validateLiveRunInput(body)).toThrow('Explicit');
  });

  it('rejects more than four contacts', () => {
    const body = validBody();
    body.contacts.push({
      role: 'pump_operator',
      name: 'E',
      phone: '+6581234571',
    });
    expect(() => validateLiveRunInput(body)).toThrow('Exactly four');
  });

  it('produces the same role key for duplicate retries', () => {
    const first = idempotencyKey('run-12345678', 'pump_operator');
    const second = idempotencyKey('run-12345678', 'pump_operator');
    expect(second).toBe(first);
  });

  it('rejects live API requests when live mode is disabled', async () => {
    process.env.ENABLE_LIVE_CALLS = 'false';
    const response = await POST(request(validBody()));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('disabled'),
    });
  });

  it('returns a safe 400 for invalid API input', async () => {
    process.env.ENABLE_LIVE_CALLS = 'true';
    const body = validBody();
    body.contacts[0].phone = 'not-a-phone';
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('+6581234567');
  });
});
