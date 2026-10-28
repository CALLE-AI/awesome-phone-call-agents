import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const load = (file) => JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
const appointment = load('calle-appointment-recoverable.workflow.json');
const goal = load('calle-goal-configuration.workflow.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const find = (flow, name) => flow.nodes.find((node) => node.name === name);
const settings = { dry_run: false, data_table_id: 'table_1', row_id: 1 };
const businessRow = { id: 1, business_event_id: 'appointment_8472', phone: '+12025550123', appointment_reference: 'booking-8472', appointment_time: 'Friday at 10 am' };

async function execute(flow, name, input, previous = {}) {
  const items = (Array.isArray(input) ? input : [input]).map((json) => ({ json }));
  const $ = (node) => ({ first: () => ({ json: previous[node] }) });
  return new AsyncFunction('$input', '$', find(flow, name).parameters.jsCode)({ first: () => items[0], all: () => items }, $);
}

const prepare = async (row = businessRow) => (await execute(appointment, 'Prepare Appointment', row, { 'Appointment Settings': settings }))[0].json;

test('exports stay inactive, manual, credential-free, and preview-first', async () => {
  for (const flow of [appointment, goal]) {
    assert.equal(flow.active, false);
    assert.deepEqual(flow.nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.type), ['n8n-nodes-base.manualTrigger']);
    assert.ok(flow.nodes.filter((n) => n.type === '@call-e/n8n-nodes-calle.calle').every((n) => n.typeVersion === 2 && !n.credentials));
    assert.deepEqual(flow.pinData, {});
  }
  assert.equal((await execute(appointment, 'Appointment Settings', {}))[0].json.dry_run, true);
  assert.equal((await execute(goal, 'Goal Settings and Business Mapping', {}))[0].json.dry_run, true);
  assert.ok(!JSON.stringify([appointment, goal]).includes('$env'));
});

test('saves the original request before POST and uses native durable waiting and existing-row updates', () => {
  const wait = find(appointment, 'Durable Wait');
  assert.equal(wait.type, 'n8n-nodes-base.wait');
  assert.equal(wait.parameters.unit, 'seconds');
  assert.ok(wait.parameters.amount >= 65);
  assert.equal(appointment.connections['Durable Wait'].main[0][0].node, 'Get CALL-E Call');
  for (const n of appointment.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable')) {
    assert.ok(['get', 'update'].includes(n.parameters.operation), 'Never create duplicate business rows.');
    assert.equal(n.parameters.matchType, 'allConditions');
    assert.ok(n.parameters.filters.conditions.some((f) => f.keyName === 'id' && f.condition === 'eq'));
  }
  assert.ok(find(appointment, 'Save Original Request').parameters.filters.conditions.some((f) => f.keyName === 'original_request_json' && f.condition === 'isEmpty'));
  assert.equal(appointment.connections['Save Original Request'].main[0][0].node, 'Read Saved Appointment');
  assert.equal(appointment.connections['Accepted Call Saved?'].main[1][0].node, 'Create CALL-E Call');
  assert.equal(appointment.connections['Cached Terminal Result?'].main[0][0].node, 'Map Business Result');
  assert.equal(appointment.connections['Already Written?'].main[0][0].node, 'Already Complete');
  const create = find(appointment, 'Create CALL-E Call').parameters;
  for (const name of ['phoneNumber', 'task', 'resultSchema']) assert.match(create[name], /JSON\.parse\(\$json\.original_request_json\)/);
  assert.equal(create.idempotencyKey, '={{ $json.idempotency_key }}');
});

test('repeated events keep the saved body and key even when editable appointment inputs change', async () => {
  const first = await prepare();
  assert.equal(first.idempotency_key, 'appointment:table_1:1:appointment_8472');
  const saved = { ...first, phone: '+14155550111', appointment_time: 'Edited later', call_id: 'call_accepted' };
  const replay = await prepare(saved);
  assert.equal(replay.original_request_json, first.original_request_json);
  assert.equal(replay.idempotency_key, first.idempotency_key);
  assert.equal(JSON.parse(replay.original_request_json).phone, businessRow.phone);
  await assert.rejects(prepare({ ...saved, business_event_id: 'changed' }), /Saved request identity changed/);
  await assert.rejects(prepare({ ...businessRow, call_id: 'call_accepted' }), /Incomplete recovery record/);
});

test('rejects missing rows, placeholder destinations, and incomplete business inputs before dialing', async () => {
  await assert.rejects(prepare({}), /exactly one existing/);
  await assert.rejects(prepare({ ...businessRow, phone: '+14155550100' }), /shipped example/);
  await assert.rejects(prepare({ ...businessRow, phone: '5550100' }), /authorized E.164/);
  await assert.rejects(prepare({ ...businessRow, appointment_time: '' }), /reference and time/);
  await assert.rejects(prepare({ ...businessRow, business_event_id: '' }), /stable business_event_id/);
});

test('requires durable request and accepted API ID readbacks', async () => {
  const saved = await prepare();
  await assert.rejects(execute(appointment, 'Validate Saved Request', businessRow, { 'Prepare Appointment': saved }), /durably saved/);
  await assert.rejects(execute(appointment, 'Validate Accepted Call', { id: 'billing_identifier' }), /no valid Call ID/);
  const accepted = { ...saved, call_id: 'call_accepted' };
  assert.equal((await execute(appointment, 'Call Context', accepted, { 'Validate Saved Request': saved }))[0].json.call_id, accepted.call_id);
  await assert.rejects(execute(appointment, 'Call Context', { ...accepted, original_request_json: '{}' }, { 'Validate Saved Request': saved }), /not saved/);
});

test('telephone completion with pending result keeps waiting and does not imply confirmation', async () => {
  const row = { ...businessRow, call_id: 'call_accepted' };
  const response = { id: row.call_id, metadata: { business_event_id: row.business_event_id }, status: 'completed', result_status: 'pending', result: null };
  const item = (await execute(appointment, 'Inspect Result Readiness', response, { 'Call Context': row }))[0].json;
  assert.equal(item.ready, false);
  assert.equal(item.result_json, '');
  await assert.rejects(execute(appointment, 'Inspect Result Readiness', { ...response, id: 'call_other' }, { 'Call Context': row }), /Unexpected Call response/);
  await assert.rejects(execute(appointment, 'Inspect Result Readiness', { ...response, metadata: {} }, { 'Call Context': row }), /Unexpected Call response/);
});

test('only explicit usable results confirm or request rescheduling; unknown/unavailable/failed stay unknown', async () => {
  for (const [resultStatus, callStatus, result, expected] of [
    ['available', 'completed', { appointment_status: 'confirmed' }, 'confirmed'],
    ['available', 'completed', { appointment_status: 'reschedule_requested', preferred_time: 'Monday' }, 'reschedule_requested'],
    ['available', 'completed', { appointment_status: 'unknown' }, 'unknown'],
    ['available', 'completed', {}, 'unknown'],
    ['unavailable', 'completed', { appointment_status: 'confirmed' }, 'unknown'],
    ['not_applicable', 'canceled', null, 'unknown'],
    ['available', 'failed', { appointment_status: 'confirmed' }, 'unknown'],
  ]) {
    const mapped = (await execute(appointment, 'Map Business Result', { ...businessRow, call_id: 'call_accepted', result_status: resultStatus, call_status: callStatus, result_json: JSON.stringify(result) }))[0].json;
    assert.equal(mapped.appointment_status, expected);
    assert.equal(mapped.preferred_time, expected === 'reschedule_requested' ? 'Monday' : '');
  }
});

test('writeback failure retains cached terminal result and does not silently succeed on a missing row', async () => {
  const saved = await prepare();
  await assert.rejects(execute(appointment, 'Receipt', {}, { 'Prepare Appointment': saved }), /writeback did not update/);
  const row = { ...saved, call_id: 'call_accepted', result_status: 'available', call_status: 'completed', result_json: JSON.stringify({ appointment_status: 'confirmed' }) };
  const validated = (await execute(appointment, 'Validate Saved Request', row, { 'Prepare Appointment': saved }))[0].json;
  assert.equal(validated.result_json, row.result_json);
  const written = { ...row, appointment_status: 'confirmed', writeback_event_id: row.business_event_id, preferred_time: 'Call +12763229632' };
  const receipt = (await execute(appointment, 'Receipt', written, { 'Prepare Appointment': saved }))[0].json;
  assert.equal(receipt.writeback_complete, true);
  assert.ok(!JSON.stringify(receipt).includes(businessRow.phone));
});

test('Goal example blocks creation until both readiness and explicit live mode, then checks accepted publication', async () => {
  for (const ready of [true, false]) for (const dryRun of [true, false]) {
    const output = (await execute(goal, 'Review Fields and Mapping', { ready }, { 'Goal Settings and Business Mapping': { dry_run: dryRun, phone: businessRow.phone, business_event_id: 'goal_evt' } }))[0].json;
    assert.equal(output.live, ready && !dryRun);
  }
  const prepared = { goal_id: 'goal_test', run_spec_id: 'rspec_1', run_spec_version: 1 };
  const run = { id: 'rgrp_1', goal_id: 'goal_test', run_spec: { id: 'rspec_1', version: 1 }, status: 'completed', result_status: 'available', result: { confirmed: 'yes' } };
  const map = async (value) => (await execute(goal, 'Map Explicit Goal Result', value, { 'Prepare Goal Run Configuration': prepared }))[0].json;
  assert.equal((await map(run)).business_status, 'confirmed');
  assert.equal((await map({ ...run, result: { confirmed: 'unknown' } })).business_status, 'unknown');
  assert.equal((await map({ ...run, result_status: 'unavailable' })).business_status, 'unknown');
  assert.equal((await map({ ...run, run_spec: { id: 'rspec_2', version: 2 } })).business_status, 'review_required');
  assert.equal((await map({ ...run, run_spec: { id: 'rspec_2', version: 2 } })).goal_run_id, run.id);
});
