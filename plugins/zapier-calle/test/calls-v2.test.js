import { describe, it, expect, afterEach } from 'vitest';
import { createAppTester } from 'zapier-platform-core';
import App from '../index.js';
import { buildPayload } from '../lib/build-payload.js';
import { parseResultSchema } from '../lib/result-schema.js';
import { flattenResult } from '../lib/flatten-result.js';
import { startFakeCalle } from './fake-calle-server.js';
import { checkForErrors } from '../lib/client.js';

const schema = {
  type: 'object', additionalProperties: false,
  properties: { business_confirmed: { type: 'boolean' }, business_confirmed_quote: { type: 'string' }, count: { type: 'integer' } },
  required: ['business_confirmed', 'business_confirmed_quote', 'count'],
};
const input = { phone: '+15550123456', task: 'Ask in English for confirmation.', result_schema: schema, dry_run: false, correlation_id: 'one-intention' };
const ready = {
  id: 'api_call', object: 'call', call_id: 'telephone_billing_id', status: 'completed', result_status: 'available', call_outcome: 'completed',
  result: { business_confirmed: true, business_confirmed_quote: 'Yes, I confirm.', count: 0 },
  transcript: [{ speaker: 'user', text: 'Yes, I confirm.', offset_seconds: 2 }], error: null,
  created_at: new Date(Date.now() - 60000).toISOString(), completed_at: new Date().toISOString(),
};
const eventFor = (patch = {}, type = 'call.completed') => ({ id: 'evt', type, data: { ...ready, ...patch } });
const flatten = (patch = {}, type) => flattenResult(eventFor(patch, type), { resultSchema: schema });

describe('Calls v2 result and transcript contract', () => {
  it('uses API id separately from Billing id and exposes only v2 result fields', () => {
    const out = flatten();
    expect(out.disposition).toBe('confirmed');
    expect(out.result_count).toBe(0);
    expect(out.call_id).toBe('api_call');
    expect(out.telephone_call_id).toBe('telephone_billing_id');
    expect(out.transcript_text).toBe('user: Yes, I confirm.');
    for (const old of ['task_completed', 'confidence_score', 'confidence_label', 'attempts_total', 'recipients_total', 'structured_result', 'evidence']) expect(out).not.toHaveProperty(old);
  });
  it.each([
    ['pending after completion', { result_status: 'pending' }, 'outcome_unknown'],
    ['empty available result', { result: {} }, 'review_required'],
    ['unavailable without error', { result_status: 'unavailable', result: null }, 'review_required'],
    ['canceled', { status: 'canceled', result_status: 'not_applicable', call_outcome: null, result: null }, 'canceled'],
    ['technical failure', { status: 'failed', result_status: 'not_applicable', call_outcome: null, result: null, error: { code: 'provider_unavailable' } }, 'failed'],
    ...['no_answer', 'busy', 'declined'].map(outcome => [outcome, { call_outcome: outcome }, 'review_required']),
    ['unknown readiness', { result_status: 'future' }, 'needs_human'],
    ['unknown status', { status: 'future' }, 'needs_human'],
    ['nested result', { result: { ...ready.result, count: {} } }, 'review_required'],
    ['nullable result', { result: { ...ready.result, count: null } }, 'review_required'],
    ['wrong scalar type', { result: { ...ready.result, count: '0' } }, 'review_required'],
    ['extra field', { result: { ...ready.result, extra: true } }, 'review_required'],
    ['missing required field', { result: { business_confirmed: true, business_confirmed_quote: 'Yes, I confirm.' } }, 'review_required'],
    ['business denial', { result: { ...ready.result, business_confirmed: false } }, 'review_required'],
    ['missing quote', { result: { ...ready.result, business_confirmed_quote: '' } }, 'review_required'],
    ['invented quote', { result: { ...ready.result, business_confirmed_quote: 'I agree to buy it.' } }, 'review_required'],
    ['bot-only quote', { transcript: [{ speaker: 'bot', text: 'Yes, I confirm.' }] }, 'review_required'],
    ['no transcript', { transcript: [] }, 'review_required'],
    ['partly unreadable transcript', { transcript: [...ready.transcript, { speaker: 'user', text: null }] }, 'review_required'],
  ])('%s cannot confirm the business outcome', (_, patch, disposition) => {
    const out = flatten(patch);
    expect(out.disposition).toBe(disposition);
    expect(out.is_actionable).toBe(false);
  });
  it.each(['No, I cannot take this incident.', "I don't agree.", 'I am unsure.'])('reviews an affirmative field with denial evidence: %s', (quote) => {
    const out = flatten({ result: { ...ready.result, business_confirmed_quote: quote }, transcript: [{ speaker: 'user', text: quote }] });
    expect(out.disposition).toBe('review_required');
    expect(out.is_actionable).toBe(false);
  });
  it('keeps business confirmation subordinate to an opt-out in the top-level transcript', () => {
    const out = flatten({ transcript: [...ready.transcript, { speaker: 'user', text: 'Please stop calling me.', offset_seconds: 8 }] });
    expect(out.opt_out_requested).toBe(true);
    expect(out.opt_out_offset_seconds).toBe(8);
    expect(out.is_actionable).toBe(false);
    expect(out.lead_state).toBe('blocked_compliance');
  });
  it('does not treat the bot reading an opt-out disclosure as a request', () => {
    const out = flatten({ transcript: [...ready.transcript, { speaker: 'bot', text: 'You can say stop calling me.' }] });
    expect(out.opt_out_requested).toBe(false);
    expect(out.is_actionable).toBe(true);
  });
});

describe('Calls v2 request contract', () => {
  it.each([
    undefined,
    { ...schema, additionalProperties: true },
    { ...schema, properties: { items: { type: 'array', items: { type: 'string' } } } },
    { ...schema, properties: { nested: { type: 'object', properties: {} } } },
    { ...schema, properties: { value: { type: ['string', 'null'] } } },
    { ...schema, properties: { value: { type: 'string', minLength: 1 } } },
    { ...schema, properties: { value: { type: 'integer', enum: ['1'] } } },
    { ...schema, properties: { value: { type: 'string', enum: [] } } },
    { ...schema, properties: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, { type: 'string' }])) },
    { ...schema, required: ['absent'] },
    { ...schema, required: ['count', 'count'] },
  ])('rejects unsupported schemas before any create', (candidate) => {
    expect(parseResultSchema(candidate).errors.length).toBeGreaterThan(0);
    expect(buildPayload({ ...input, result_schema: candidate }).errors.length).toBeGreaterThan(0);
  });
  it('accepts an empty closed result schema without inventing an answer', () => {
    expect(parseResultSchema({ type: 'object', properties: {}, additionalProperties: false }).errors).toEqual([]);
  });
  it('keys phone, region and locale changes separately and preserves omitted hints', () => {
    const original = buildPayload(input);
    expect(original.payload).not.toHaveProperty('recipients');
    expect(original.payload).not.toHaveProperty('region');
    expect(original.payload).not.toHaveProperty('locale');
    for (const patch of [{ phone: '+15550123457' }, { region: 'US' }, { locale: 'en-US' }]) {
      expect(buildPayload({ ...input, ...patch }).key).not.toBe(original.key);
    }
  });
  it('surfaces v2 clarification inputs and preserves key/body on conflict', () => {
    expect(() => checkForErrors({ status: 422, content: JSON.stringify({ error: { code: 'input_incomplete', details: { missing_inputs: ['locale'] } } }) })).toThrow(/locale/);
    expect(() => checkForErrors({ status: 409, content: JSON.stringify({ error: { code: 'idempotency_conflict' } }) })).toThrow(/original key, payload and callback URL/);
  });
});

let server;
const tester = createAppTester(App);
afterEach(async () => { if (server) await server.close(); server = null; });
describe('v2 recovery through the Zapier runtime', () => {
  const start = async () => {
    server = await startFakeCalle({});
    const bundle = { authData: { apiKey: 'test', baseUrl: server.url }, inputData: input };
    const output = await tester(App.creates.place_call_and_wait.operation.perform, bundle);
    server.setStatus(output.call_id, { ...ready, id: output.call_id });
    return { bundle, output, callback: { id: 'evt', type: 'call.completed', data: { id: output.call_id, object: 'call' } } };
  };
  it('replays the original execution without another Call, including after completion', async () => {
    const { bundle, output } = await start();
    const replay = await tester(App.creates.place_call_and_wait.operation.perform, bundle);
    expect(replay.call_id).toBe(output.call_id);
    expect(replay.status).toBe('completed');
    expect(server.callCount()).toBe(1);
  });
  it('returns conflict if a retry changes only its callback URL, never redials', async () => {
    const { output } = await start();
    const original = server.lastRequest();
    const response = await fetch(`${server.url}/v2/calls`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': output.idempotency_key }, body: JSON.stringify({ ...original.body, webhook_url: 'https://example.com/different-run' }) });
    expect(response.status).toBe(409);
    expect(server.callCount()).toBe(1);
  });
  it.each([undefined, '{bad json', { type: 'array' }])('refuses to resume without the original valid schema: %s', async (result_schema) => {
    const { bundle, output, callback } = await start();
    const out = await tester(App.creates.place_call_and_wait.operation.performResume, { ...bundle, inputData: { result_schema }, outputData: output, cleanedRequest: callback });
    expect(out.disposition).toBe('needs_human');
    expect(out.verified).toBe(false);
    expect(out.is_actionable).toBe(false);
  });
  it('authenticates the Call and rejects wrong resource IDs, including Billing IDs', async () => {
    const { bundle, output, callback } = await start();
    for (const id of ['wrong', 'telephone_billing_id']) {
      server.setStatus(output.call_id, { id });
      const out = await tester(App.creates.place_call_and_wait.operation.performResume, { ...bundle, outputData: output, cleanedRequest: callback });
      expect(out.verified).toBe(false);
      expect(out.is_actionable).toBe(false);
    }
  });
  it('keeps repeated static notifications non-actionable and reads authoritative results', async () => {
    const { bundle, output, callback } = await start();
    for (let i = 0; i < 2; i += 1) {
      const [out] = await tester(App.triggers.call_completed.operation.perform, { ...bundle, cleanedRequest: { ...callback, id: `forged_${i}` } });
      expect(out.verified).toBe(true);
      expect(out.is_actionable).toBe(false);
      expect(server.lastRequest().headers.authorization).toBe('Bearer test');
    }
    server.setStatus(output.call_id, { result_status: 'unavailable', result: null });
    const out = await tester(App.creates.place_call_and_wait.operation.performResume, { ...bundle, outputData: output, cleanedRequest: { ...callback, data: { ...ready, id: output.call_id } } });
    expect(out.is_actionable).toBe(false);
    expect(server.callCount()).toBe(1);
  });
  it('reconciles completed but pending results using the original API id without redialing', async () => {
    const { bundle, output } = await start();
    server.setStatus(output.call_id, { result_status: 'pending', result: null, created_at: new Date(Date.now() - 20 * 60000).toISOString() });
    const [out] = await tester(App.searches.find_call_result.operation.perform, { ...bundle, inputData: { call_id: output.call_id, max_wait_minutes: 10 } });
    expect(out.reconciliation_timed_out).toBe(true);
    expect(out.disposition).toBe('needs_human');
    expect(out.call_id).toBe(output.call_id);
    expect(server.callCount()).toBe(1);
  });
  it('reports a missing lookup as an error instead of silently dropping the reconciliation', async () => {
    const { bundle } = await start();
    await expect(tester(App.searches.find_call_result.operation.perform, { ...bundle, inputData: { call_id: 'missing' } })).rejects.toThrow(/no such call/);
  });
});

describe('documented v2 recipe schemas', () => {
  it('validates every copyable example and retains explicit confirmation evidence', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const directory = new URL('../examples/', import.meta.url);
    let count = 0;
    for (const file of readdirSync(directory)) {
      const text = readFileSync(new URL(file, directory), 'utf8');
      for (const match of text.matchAll(/```json\n([\s\S]*?)\n```/g)) {
        const example = JSON.parse(match[1]);
        expect(parseResultSchema(example).errors, file).toEqual([]);
        expect(example.required).toContain('business_confirmed');
        expect(example.required).toContain('business_confirmed_quote');
        count += 1;
      }
    }
    expect(count).toBe(4);
  });
});
