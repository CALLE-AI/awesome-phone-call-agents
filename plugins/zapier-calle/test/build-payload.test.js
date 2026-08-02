import { describe, it, expect } from 'vitest';
import { buildPayload } from '../lib/build-payload.js';

const input = {
  task: 'Call the on-call engineer and get an acknowledgement.',
  phone: '+15550123456',
  region: 'US',
  locale: 'en-US',
  result_schema: '{"type":"object","properties":{"acknowledged":{"type":"string"}}}',
  correlation_id: 'incident-42',
};

describe('buildPayload', () => {
  it('builds a valid create-call payload', () => {
    const { payload, errors } = buildPayload(input, {});
    expect(errors).toEqual([]);
    expect(payload.task).toBe(input.task);
    expect(payload.recipients).toEqual([
      { phones: ['+15550123456'], region: 'US', locale: 'en-US' },
    ]);
    expect(payload.metadata.correlation_id).toBe('incident-42');
  });

  it('rejects a phone number that is not E.164', () => {
    expect(buildPayload({ ...input, phone: '555-0123' }, {}).errors.join(' '))
      .toContain('E.164');
    expect(buildPayload({ ...input, phone: '15550123456' }, {}).errors.join(' '))
      .toContain('E.164');
  });

  it('requires a task', () => {
    expect(buildPayload({ ...input, task: '   ' }, {}).errors.join(' ')).toContain('task');
  });

  it('omits region and locale when not supplied rather than guessing', () => {
    const { payload } = buildPayload({ task: input.task, phone: input.phone }, {});
    expect(payload.recipients[0]).toEqual({ phones: ['+15550123456'] });
  });

  it('surfaces result schema errors', () => {
    const { errors } = buildPayload({ ...input, result_schema: '{"type":"object","additionalProperties":true}' }, {});
    expect(errors.join(' ')).toContain('additionalProperties');
  });

  it('includes webhook_url only when one is provided', () => {
    expect(buildPayload(input, {}).payload.webhook_url).toBeUndefined();
    expect(buildPayload(input, { webhookUrl: 'https://hooks.zapier.com/x' }).payload.webhook_url)
      .toBe('https://hooks.zapier.com/x');
  });

  it('produces a key that ignores webhook_url', () => {
    const a = buildPayload(input, { webhookUrl: 'https://hooks.zapier.com/a' });
    const b = buildPayload(input, { webhookUrl: 'https://hooks.zapier.com/b' });
    expect(a.key).toBe(b.key);
  });
});
