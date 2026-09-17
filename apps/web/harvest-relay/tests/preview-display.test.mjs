import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildCallRequest, maskForDisplay } from '../src/calle.mjs';
import { createAppServer } from '../src/server.mjs';

const phone = '+12025550100';
test('display masking covers free text without modifying private dispatch input', () => {
  const original = { recipients: [{ phones: [phone] }], task: `Ask the operator at ${phone}.` };
  const displayed = maskForDisplay(original);
  assert.ok(!JSON.stringify(displayed).includes(phone));
  assert.equal(original.recipients[0].phones[0], phone);
  assert.ok(original.task.includes(phone));
});

test('HTTP preview handler masks destinations without any socket or provider call', async () => {
  const server = createAppServer({ env: {}, fetchImpl: async () => { throw new Error('No network expected'); } });
  let status, body;
  const request = { method: 'GET', url: `/api/preview?provider_type=storage&provider_id=orchard&phone=${encodeURIComponent(phone)}` };
  const response = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  await server.listeners('request')[0](request, response);
  assert.equal(status, 200);
  assert.equal(body.dialed, false);
  assert.ok(!JSON.stringify(body).includes(phone));
  assert.deepEqual(body.request.recipients[0].phones, ['+1***0100']);
  const scenario = JSON.parse(await readFile(new URL('../web/scenario.json', import.meta.url), 'utf8'));
  assert.equal(buildCallRequest(scenario, { providerType: 'storage', providerId: 'orchard', phone }).recipients[0].phones[0], phone);
});
