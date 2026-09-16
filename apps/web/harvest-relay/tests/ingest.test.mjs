import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestCallResult, prepareReviewedScenario } from '../src/ingest.mjs';
import { evaluatePairs } from '../web/engine.js';
import { main } from '../src/cli.mjs';
import { buildCallRequest } from '../src/calle.mjs';

const demo = JSON.parse(await readFile(new URL('../web/scenario.json', import.meta.url), 'utf8'));
const context = () => ({ ...structuredClone(demo), service_date: '2026-09-14', timezone: 'America/Los_Angeles', evidence_mode: 'test' });
const options = (providerType = 'storage', providerId = 'riverside') => ({ providerType, providerId, reviewed: true });
const common = { availability: 'yes', capacity_kg: 1000, min_temp_c: 0, max_temp_c: 4, cost_usd: 150, valid_until_min: 870, service_date: '2026-09-14', timezone: 'America/Los_Angeles', evidence: 'TEST fixture: provider confirms the stated facts.' };

function callFixture(type = 'storage', providerId = 'riverside') {
  const facts = type === 'storage' ? { ...common, receive_from_min: 840, receive_until_min: 960 } : { ...common, cost_usd: 160, pickup_min: 815, travel_min: { orchard: 50, riverside: 50, hillcrest: 40 } };
  return {
    id: `call_TEST_${providerId}`, object: 'call_task', status: 'completed', task: 'TEST fixture; no actual call was placed.',
    recipients: [{ id: `rcp_TEST_${providerId}`, phones: ['+12025550123'], region: 'US', locale: 'en-US', status: 'completed', structured_result: facts, summary: 'TEST fixture result.',
      attempts: [{ id: `att_TEST_${providerId}`, phone: '+12025550123', status: 'completed', started_at: '2026-09-14T20:00:00Z', completed_at: '2026-09-14T20:02:00Z', summary: 'TEST fixture conversation.', transcript_turns: [{ offset_seconds: 0, speaker: 'bot', text: 'TEST fixture: please confirm availability.' }, { offset_seconds: 8, speaker: 'user', text: 'TEST fixture: the stated capacity, times and price are correct.' }], provider_call_id: `provider_TEST_${providerId}`, failure_code: null, failure_message: null }],
    }],
    structured_result: null, summary: 'TEST fixture.', task_completed: true, completion_confidence: { score: 0.9, label: 'high' }, evidence: ['TEST fixture only.'],
    metadata: { app: 'harvest-relay', provider_type: type, provider_id: providerId, source_provenance: 'synthetic', evidence_mode: 'test', booking_authorized: false },
    failure_code: null, failure_message: null, created_at: '2026-09-14T20:00:00Z', completed_at: '2026-09-14T20:02:00Z',
  };
}

test('first reviewed import removes every unreviewed fixture quote and preserves exact source evidence', () => {
  const initial = context();
  const before = structuredClone(initial);
  const call = callFixture();
  const result = ingestCallResult(initial, call, options());
  assert.deepEqual(initial, before);
  assert.equal(result.provenance, 'reviewed-call-results');
  assert.equal(result.evidence_mode, 'test');
  assert.match(result.notice, /TEST/);
  for (const provider of [...result.storages.filter(s => s.id !== 'riverside'), ...result.carriers]) {
    assert.equal(provider.status, 'unknown');
    for (const field of ['capacity_kg', 'cost_usd', 'min_temp_c', 'valid_until_min', 'call_id', 'transcript', 'evidence']) assert.equal(Object.hasOwn(provider, field), false, `${provider.id} retained ${field}`);
  }
  const imported = result.storages.find(s => s.id === 'riverside');
  assert.equal(imported.call_id, call.id);
  assert.equal(imported.source.reviewed, true);
  assert.deepEqual(imported.source_call, call);
  assert.equal(imported.transcript[1].text, call.recipients[0].attempts[0].transcript_turns[1].text);
  assert.equal(evaluatePairs(result).best, null);
});

test('two reviewed official-shaped TEST calls produce a computed storage and transport plan', () => {
  const storage = ingestCallResult(context(), callFixture(), options());
  const both = ingestCallResult(storage, callFixture('carrier', 'swift'), options('carrier', 'swift'));
  const solved = evaluatePairs(both);
  assert.equal(solved.best.id, 'riverside--swift');
  assert.equal(solved.best.cost_usd, 310);
  assert.equal(solved.best.handoff_min, 865);
  assert.equal(solved.feasible.length, 1);
  assert.equal(both.evidence_mode, 'test');
});

test('incremental imports rebuild reviewed facts from source instead of trusting edited quote values', () => {
  const first = ingestCallResult(context(), callFixture(), options());
  first.storages.find(s => s.id === 'riverside').cost_usd = 1;
  first.storages.find(s => s.id === 'orchard').status = 'confirmed';
  first.storages.find(s => s.id === 'orchard').capacity_kg = 9999;
  const next = ingestCallResult(first, callFixture('carrier', 'swift'), options('carrier', 'swift'));
  assert.equal(next.storages.find(s => s.id === 'riverside').cost_usd, 150);
  assert.equal(next.storages.find(s => s.id === 'orchard').status, 'unknown');
  assert.equal(Object.hasOwn(next.storages.find(s => s.id === 'orchard'), 'capacity_kg'), false);
});

test('ingest requires explicit factual review and a completed, successful task judgment', () => {
  assert.throws(() => ingestCallResult(context(), callFixture(), { ...options(), reviewed: false }), { code: 'review_required' });
  for (const changed of [{ status: 'in_progress' }, { task_completed: false }, { object: 'wrong' }, { completed_at: null }]) {
    assert.throws(() => ingestCallResult(context(), { ...callFixture(), ...changed }, options()), { code: 'invalid_call_result' });
  }
  const missing = callFixture(); delete missing.metadata;
  assert.throws(() => ingestCallResult(context(), missing, options()), { code: 'invalid_call_result' });
});

test('provider identity and exactly one matching recipient are mandatory', () => {
  assert.throws(() => ingestCallResult(context(), callFixture(), options('storage', 'orchard')), { code: 'provider_mismatch' });
  const multiple = callFixture(); multiple.recipients.push(structuredClone(multiple.recipients[0]));
  assert.throws(() => ingestCallResult(context(), multiple, options()), { code: 'invalid_call_result' });
});

test('confirmed numeric fields cannot be missing, numeric strings, null, or inverted ranges', () => {
  for (const [field, value] of [['cost_usd', undefined], ['capacity_kg', '1000'], ['min_temp_c', null], ['receive_until_min', 800], ['valid_until_min', 1600]]) {
    const call = callFixture();
    if (value === undefined) delete call.recipients[0].structured_result[field]; else call.recipients[0].structured_result[field] = value;
    assert.throws(() => ingestCallResult(context(), call, options()), { code: 'invalid_facts' }, field);
  }
  const carrier = callFixture('carrier', 'swift'); delete carrier.recipients[0].structured_result.travel_min;
  assert.throws(() => ingestCallResult(context(), carrier, options('carrier', 'swift')), { code: 'invalid_facts' });
});

test('unknown outcomes remain unknown without borrowing fixture numbers', () => {
  const call = callFixture();
  call.recipients[0].structured_result = { availability: 'unknown', evidence: 'TEST: availability remained unclear.', service_date: common.service_date, timezone: common.timezone };
  const result = ingestCallResult(context(), call, options());
  const provider = result.storages.find(s => s.id === 'riverside');
  assert.equal(provider.status, 'unknown');
  assert.equal(Object.hasOwn(provider, 'capacity_kg'), false);
  assert.equal(evaluatePairs(result).best, null);
});

test('dates and timezones must be explicitly valid and match the scenario local day', () => {
  for (const changed of [{ service_date: undefined }, { service_date: '2026-02-30' }, { timezone: 'Mars/Olympus' }]) {
    assert.throws(() => ingestCallResult({ ...context(), ...changed }, callFixture(), options()), { code: 'invalid_scenario_context' });
  }
  for (const changed of [{ service_date: '2026-09-15' }, { timezone: 'Asia/Shanghai' }, { timezone: undefined }]) {
    const call = callFixture(); Object.assign(call.recipients[0].structured_result, changed);
    assert.throws(() => ingestCallResult(context(), call, options()), { code: 'invalid_facts' });
  }
});

test('affirmative quotes require a usable recipient transcript and reject foreign schema fields', () => {
  const call = callFixture(); call.recipients[0].attempts[0].transcript_turns = [];
  assert.throws(() => ingestCallResult(context(), call, options()), { code: 'invalid_call_result' });
  const extra = callFixture(); extra.recipients[0].structured_result.status = 'confirmed';
  assert.throws(() => ingestCallResult(context(), extra, options()), { code: 'invalid_facts' });
});

test('TEST and operator-supplied quotes cannot be silently mixed', () => {
  const first = ingestCallResult(context(), callFixture(), options());
  const operator = callFixture('carrier', 'swift');
  operator.metadata.source_provenance = 'operator-supplied'; delete operator.metadata.evidence_mode;
  assert.throws(() => ingestCallResult(first, operator, options('carrier', 'swift')), { code: 'mixed_evidence' });
});

test('preparing an unimported scenario cannot expose synthetic confirmed quotes to the solver', () => {
  const prepared = prepareReviewedScenario(context());
  assert.equal(evaluatePairs(prepared).best, null);
  assert.ok([...prepared.storages, ...prepared.carriers].every(provider => provider.status === 'unknown'));
});

test('a reviewed TEST scenario remains a fictional call prompt with explicit local-day context', () => {
  const imported = ingestCallResult(context(), callFixture(), options());
  const request = buildCallRequest(imported, { providerType: 'carrier', providerId: 'swift', phone: '+12025550123' });
  assert.match(request.task, /fictional/);
  assert.match(request.task, /2026-09-14/);
  assert.match(request.task, /America\/Los_Angeles/);
  assert.equal(request.metadata.evidence_mode, 'test');
});

test('an unfinished attempt cannot support an imported confirmed quote', () => {
  const call = callFixture(); call.recipients[0].attempts[0].status = 'in_progress';
  assert.throws(() => ingestCallResult(context(), call, options()), { code: 'invalid_call_result' });
});

test('CLI imports private snapshots incrementally and solves without any network call', async t => {
  const root = await mkdtemp(join(tmpdir(), 'harvest-ingest-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeDir = join(root, 'runtime');
  const initial = join(root, 'context.json');
  const storageCall = join(root, 'storage.json');
  const carrierCall = join(root, 'carrier.json');
  const first = join(runtimeDir, 'reviewed-1.json');
  const second = join(runtimeDir, 'reviewed-2.json');
  await Promise.all([writeFile(initial, JSON.stringify(context())), writeFile(storageCall, JSON.stringify(callFixture())), writeFile(carrierCall, JSON.stringify(callFixture('carrier', 'swift')))]);
  const out = [], errors = [];
  const io = { env: {}, runtimeDir, stdout: value => out.push(value), stderr: value => errors.push(value), fetchImpl: () => { throw new Error('No network is permitted'); } };
  assert.equal(await main(['ingest', '--scenario', initial, '--file', storageCall, '--type', 'storage', '--provider', 'riverside', '--output', first, '--reviewed'], io), 0, errors.join('\n'));
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  assert.equal(await main(['ingest', '--scenario', first, '--file', carrierCall, '--type', 'carrier', '--provider', 'swift', '--output', second, '--reviewed'], io), 0, errors.join('\n'));
  assert.equal(await main(['solve', '--scenario', second], io), 0, errors.join('\n'));
  const solved = JSON.parse(out.at(-1));
  assert.equal(solved.mode, 'test-import');
  assert.equal(solved.best.cost_usd, 310);
  assert.equal(solved.sources.length, 2);
  assert.equal(await main(['ingest', '--scenario', initial, '--file', storageCall, '--type', 'storage', '--provider', 'riverside', '--output', join(root, 'public.json'), '--reviewed'], io), 1);
  assert.equal(JSON.parse(errors.at(-1)).error.code, 'private_output_required');
});
