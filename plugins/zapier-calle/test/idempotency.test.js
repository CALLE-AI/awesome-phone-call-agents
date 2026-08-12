import { describe, it, expect } from 'vitest';
import { idempotencyKey, canonicalize } from '../lib/idempotency.js';

const base = {
  task: 'Call +15550123456 and confirm the 9am appointment.',
  recipients: [{ phones: ['+15550123456'], region: 'US', locale: 'en-US' }],
  result_schema: { type: 'object', properties: { confirmed: { type: 'string' } } },
  recipient_result_schema: null,
  metadata: { correlation_id: 'zap-1' },
};

describe('idempotencyKey', () => {
  it('returns a 64-character hex digest', () => {
    expect(idempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across identical payloads', () => {
    expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base }));
  });

  it('ignores key ordering', () => {
    const reordered = {
      metadata: { correlation_id: 'zap-1' },
      recipient_result_schema: null,
      result_schema: { properties: { confirmed: { type: 'string' } }, type: 'object' },
      recipients: [{ locale: 'en-US', region: 'US', phones: ['+15550123456'] }],
      task: base.task,
    };
    expect(idempotencyKey(reordered)).toBe(idempotencyKey(base));
  });

  it('changes when the phone number changes', () => {
    const edited = {
      ...base,
      recipients: [{ phones: ['+15550199999'], region: 'US', locale: 'en-US' }],
    };
    expect(idempotencyKey(edited)).not.toBe(idempotencyKey(base));
  });

  it('changes when the task text changes', () => {
    expect(idempotencyKey({ ...base, task: 'Call and cancel instead.' }))
      .not.toBe(idempotencyKey(base));
  });

  it('is unaffected by fields outside the canonical set', () => {
    expect(idempotencyKey({ ...base, webhook_url: 'https://a.example/x' }))
      .toBe(idempotencyKey({ ...base, webhook_url: 'https://b.example/y' }));
  });
});

describe('canonicalize', () => {
  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });
});
