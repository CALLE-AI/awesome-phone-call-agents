import test from 'node:test';
import assert from 'node:assert';
import { validateE164Phone, maskPhoneNumber } from '../src/config.js';
import { remediationEngine } from '../src/remediation.js';
import { dispatchVoiceSRECall } from '../src/calle.js';

test('E.164 Phone Validation', async (t) => {
  await t.test('accepts valid E.164 numbers', () => {
    assert.strictEqual(validateE164Phone('+12025550123'), true);
    assert.strictEqual(validateE164Phone('+84912345678'), true);
    assert.strictEqual(validateE164Phone('+447911123456'), true);
  });

  await t.test('rejects invalid phone formats', () => {
    assert.strictEqual(validateE164Phone('12025550123'), false); // missing +
    assert.strictEqual(validateE164Phone('+0123456789'), false); // starts with +0
    assert.strictEqual(validateE164Phone('+123'), false); // too short
    assert.strictEqual(validateE164Phone('phone-number'), false);
    assert.strictEqual(validateE164Phone('+1(202)555-0123'), false); // contains special characters
  });
});

test('Phone Number Masking', () => {
  const masked = maskPhoneNumber('+12025550123');
  assert.strictEqual(masked, '+12******0123');
  assert.ok(!masked.includes('555'));
});

test('Remediation Engine State Machine', async (t) => {
  await t.test('triggers P0 outage and sets critical state', () => {
    const incident = remediationEngine.triggerOutage();
    assert.ok(incident.id.startsWith('INC-'));
    assert.strictEqual(incident.severity, 'P0');
    
    const state = remediationEngine.getState();
    assert.strictEqual(state.status, 'critical');
    assert.strictEqual(state.currentVersion, 'v2.4.1');
    assert.ok(state.errorRatePercent > 40);
  });

  await t.test('executes rollback and normalizes metrics', async () => {
    const res = await remediationEngine.executeRemediation('rollback', 'v2.4.0');
    assert.strictEqual(res.success, true);
    
    const state = res.state;
    assert.strictEqual(state.status, 'healthy');
    assert.strictEqual(state.currentVersion, 'v2.4.0');
    assert.strictEqual(state.errorRatePercent, 0.01);
    assert.strictEqual(state.p99LatencyMs, 45);
  });
});

test('Preview Mode Safe Execution', async () => {
  const incident = remediationEngine.triggerOutage();
  const dispatchRes = await dispatchVoiceSRECall({
    apiKey: '',
    phoneNumber: '+12025550123',
    mode: 'preview',
    incident
  });

  assert.strictEqual(dispatchRes.mode, 'preview');
  assert.strictEqual(dispatchRes.status, 'simulated_completed');
  assert.strictEqual(dispatchRes.result.action_decision, 'rollback');
  assert.ok(dispatchRes.logs.some(l => l.includes('[PREVIEW MODE]')));
});
