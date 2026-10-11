const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Start express app on random port for testing
process.env.BRIDGE_MODE = 'simulation';
delete process.env.AUTHORIZED_E164_RECIPIENTS;
delete process.env.AUTHORIZED_RECIPIENTS;

test('security compliance test suite', async (t) => {
  const { planCall, runCall, getCallStatus } = require('../src/calle');

  await t.test('simulation mode strictly enforces simulation flags and phone masking', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const plan = await planCall({ phone: '+919876543210', goal: 'Test exception' });
    const parsed = JSON.parse(plan.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.ok(parsed.to_phone.includes('******'));
  });

  await t.test('runCall in simulation mode returns simulated payload without invoking CLI', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const run = await runCall({ planId: 'plan-xyz', confirmToken: 'token-xyz' });
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.equal(parsed.status, 'in_progress');
  });

  await t.test('getCallStatus in simulation mode returns completed simulation status', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const status = await getCallStatus({ runId: 'run-xyz' });
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.equal(parsed.status, 'completed');
  });
});
