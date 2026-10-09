import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { preview, playbook, notification, dialogue } from '../src/scenario.ts';
import { restrictiveAuthority, validatePlaybookBinding, resolveOutcomeTransition } from '../src/bound-call-runtime.mjs';
import { DemoStore } from '../src/store.ts';
import { createApp } from '../src/server.ts';

test('preview compiles the actual governed task and bounded result schema without a destination', () => {
  const view = preview();
  assert.equal(view.engine_enabled, false);
  assert.match(view.task, /NOT_ALLOWED/);
  assert.match(view.task, /test/);
  assert.deepEqual(view.result_schema.properties.outcome_code.enum, ['INTERESTED', 'NO_ANSWER']);
  assert.equal(view.result_schema.additionalProperties, false);
  assert.equal('recipients' in view, false);
});
test('authority defaults deny all actions and rejects truthy non-booleans', () => {
  assert.ok(Object.values(restrictiveAuthority({ schedule_appointment: 'true' })).every(v => v === false));
});
for (const [label, change, code] of [
  ['inactive', { active: false }, 'PLAYBOOK_INACTIVE'],
  ['wrong workflow', { workflow_call_code: 'OTHER' }, 'PLAYBOOK_INCOMPATIBLE'],
  ['wrong version', { version: 2 }, 'PLAYBOOK_VERSION_MISMATCH'],
  ['missing authority', { authority: {} }, 'PLAYBOOK_AUTHORITY_INVALID'],
  ['incomplete outcome map', { outcome_state_transitions: {} }, 'PLAYBOOK_OUTCOME_MAPPING_INVALID']
] as const) test(`binding fails closed: ${label}`, () => {
  assert.throws(() => validatePlaybookBinding({ notification, playbooks: [{ ...playbook, ...change }], dialogueDefaults: dialogue }), { code });
});
test('unknown outcome or missing state cannot authorize a transition', () => {
  assert.throws(() => resolveOutcomeTransition({ result: { outcome_code: 'BOOKED' }, playbook, state: { states: [] } }), { code: 'CALL_OUTCOME_INVALID' });
  assert.throws(() => resolveOutcomeTransition({ result: { outcome_code: 'INTERESTED' }, playbook, state: { states: [] } }), { code: 'OUTCOME_STATE_MAPPING_MISSING' });
});
test('result persists across store restart; concurrent retry does not duplicate or overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'macrodial-test-'));
  try {
    const file = join(dir, 'state.json'); const store = new DemoStore(file);
    await Promise.all([store.apply('INTERESTED'), store.apply('INTERESTED')]);
    const saved = await new DemoStore(file).read();
    assert.equal(saved.events.length, 1); assert.equal(saved.outreach_state, 'FOLLOW_UP_REVIEW');
    assert.equal(saved.events[0].previous_state, 'SCHEDULED');
    await assert.rejects(store.apply('NO_ANSWER'), /conflicting/);
    assert.deepEqual(await store.read(), saved);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('corrupt persistence fails closed, rather than resetting an existing run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'macrodial-test-'));
  try {
    const file = join(dir, 'state.json'); await writeFile(file, '{bad');
    await assert.rejects(new DemoStore(file).apply('INTERESTED'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('browser routes enforce loopback/same-origin, expose no live endpoint and reload persisted result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'macrodial-test-'));
  const file = join(dir, 'state.json');
  let server = createApp(file);
  const listen = async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); const addr = server.address(); return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`; };
  const stop = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    let origin = await listen();
    assert.match(await (await fetch(origin)).text(), /NO CALLS/);
    assert.equal((await fetch(origin + '/api/preview')).status, 200);
    const wrongHost = await new Promise(resolve => {
      const req = request(origin + '/api/preview', { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
      req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(origin + '/api/simulate/INTERESTED', { method: 'POST' })).status, 403);
    assert.equal((await fetch(origin + '/api/simulate/BOOKED', { method: 'POST', headers: { Origin: origin } })).status, 422);
    for (const route of ['/api/outreach/calls', '/api/engine', '/api/import', '/api/generate'])
      assert.equal((await fetch(origin + route, { method: 'POST', headers: { Origin: origin } })).status, 404);
    assert.equal((await fetch(origin + '/api/simulate/NO_ANSWER', { method: 'POST', headers: { Origin: origin } })).status, 200);
    await stop(); server = createApp(file); origin = await listen();
    const saved = await (await fetch(origin + '/api/state')).json();
    assert.equal(saved.outreach_state, 'UNREACHED'); assert.equal(saved.engine_enabled, false);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
