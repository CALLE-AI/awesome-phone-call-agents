const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidE164,
  maskPhone,
  maskSensitiveOutput,
  validateLiveAuthorization,
  buildCallGoal,
  simulateExtraction,
} = require('../mazo-coach.js');

test('E.164 phone validation rules', async (t) => {
  await t.test('accepts valid international E.164 formats', () => {
    assert.equal(isValidE164('+15555550199'), true);
    assert.equal(isValidE164('+201001234567'), true);
    assert.equal(isValidE164('+447911123456'), true);
    assert.equal(isValidE164('+819012345678'), true);
  });

  await t.test('rejects malformed numbers missing leading plus or non-digits', () => {
    assert.equal(isValidE164('15555550199'), false);
    assert.equal(isValidE164('+0123456789'), false);
    assert.equal(isValidE164('+123'), false); // too short
    assert.equal(isValidE164('+1 555 555 0199'), false); // unstripped spaces
    assert.equal(isValidE164('invalid-phone'), false);
    assert.equal(isValidE164(''), false);
    assert.equal(isValidE164(null), false);
  });
});

test('Live mode destination authorization & allowlist enforcement', async (t) => {
  await t.test('1. live without phone fails immediately', () => {
    const res = validateLiveAuthorization(null, '+15555550199');
    assert.equal(res.valid, false);
    assert.ok(res.error.includes('explicit authorized destination must be supplied'));
  });

  await t.test('2. live without allowlist fails immediately', () => {
    const res = validateLiveAuthorization('+15555550199', null);
    assert.equal(res.valid, false);
    assert.ok(res.error && res.error.includes('ALLOWED_RECIPIENTS'));
  });

  await t.test('3. empty allowlist fails closed', () => {
    const res = validateLiveAuthorization('+15555550199', '   ');
    assert.equal(res.valid, false);
    assert.ok(res.error.includes('empty allowlist does not enforce safety restrictions'));
  });

  await t.test('4. unauthorized destination rejected with masked output', () => {
    const res = validateLiveAuthorization('+15555550123', '+15555550999');
    assert.equal(res.valid, false);
    assert.ok(res.error.includes('is not authorized in ALLOWED_RECIPIENTS'));
    assert.ok(!res.error.includes('+15555550123'));
    assert.ok(res.error.includes('+15****23'));
  });

  await t.test('5. authorized exact destination accepted', () => {
    const res = validateLiveAuthorization('+15555550123', '+15555550999, +15555550123');
    assert.equal(res.valid, true);
    assert.equal(res.error, undefined);
  });

  await t.test('6. malformed phone produces sanitized rejection before provider dispatch', () => {
    const res = validateLiveAuthorization('invalid-phone-num', '+15555550123');
    assert.equal(res.valid, false);
    assert.ok(res.error.includes('Invalid E.164 phone number format'));
    assert.ok(!res.error.includes('invalid-phone-num'));
  });

  await t.test('11. authorization failure blocks provider dispatch', () => {
    // Contract check: if validateLiveAuthorization returns valid: false, caller must abort
    const check = validateLiveAuthorization('', '+15555550123');
    let providerCalled = false;
    if (check.valid) {
      providerCalled = true;
    }
    assert.equal(providerCalled, false);
  });
});

test('Privacy, PII and sensitive output masking', async (t) => {
  await t.test('masks middle digits for console and telemetry outputs', () => {
    const masked = maskPhone('+15555550199');
    assert.equal(masked, '+15****99');
    assert.equal(masked.includes('5555'), false);
  });

  await t.test('handles short or missing numbers safely', () => {
    assert.equal(maskPhone(''), '***');
    assert.equal(maskPhone(null), '***');
    assert.equal(maskPhone('123'), '***');
  });

  await t.test('7. CLI error output sanitized', () => {
    const rawCliErr = 'calle: failed to plan call to +12025550123 with key=sk-live-secret-key-12345';
    const clean = maskSensitiveOutput(rawCliErr, '+12025550123');
    assert.ok(!clean.includes('+12025550123'));
    assert.ok(!clean.includes('sk-live-secret-key-12345'));
    assert.ok(clean.includes('+12****23'));
  });

  await t.test('8. REST error output sanitized', () => {
    const rawRestErr = '{"error":{"message":"Failed to dispatch to +14155552671: invalid token secret_token_99999999"}}';
    const clean = maskSensitiveOutput(rawRestErr);
    assert.ok(!clean.includes('+14155552671'));
    assert.ok(!clean.includes('secret_token_99999999'));
    assert.ok(clean.includes('+14****71'));
  });

  await t.test('9. subprocess stderr sanitized', () => {
    const stderr = 'stderr: Process exited with 1: to-phone=+16505550188 authorization=secret_auth_pass_99';
    const clean = maskSensitiveOutput(stderr, '+16505550188');
    assert.ok(!clean.includes('+16505550188'));
    assert.ok(!clean.includes('secret_auth_pass_99'));
  });

  await t.test('10. bearer and API-key patterns redacted', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1Ni... and apiKey=iams_live_1234567890';
    const clean = maskSensitiveOutput(input);
    assert.ok(!clean.includes('eyJhbGciOiJIUzI1Ni'));
    assert.ok(!clean.includes('iams_live_1234567890'));
    assert.ok(clean.includes('Bearer [REDACTED]'));
  });
});

test('Call goal prompt compilation & non-clinical coaching boundaries', async (t) => {
  await t.test('compiles momentum kickoff goal with non-clinical and high-stakes exclusions', () => {
    const goal = buildCallGoal({
      coachRole: 'The Executioner',
      userName: 'Sara',
      sessionMode: 'kickoff',
      sessionTopic: 'Ship landing page MVP',
    });

    assert.ok(goal.includes('The Executioner'));
    assert.ok(goal.includes('Sara'));
    assert.ok(goal.includes('Ship landing page MVP'));
    assert.ok(goal.includes('highest-leverage next step'));
    assert.ok(goal.includes('non-clinical'));
    assert.ok(goal.includes('medical, legal, financial, or crisis decision-making'));
  });

  await t.test('compiles closed-loop followup with non-clinical coaching boundary', () => {
    const goal = buildCallGoal({
      coachRole: 'The Stoic',
      userName: 'Omar',
      sessionMode: 'followup',
    });

    assert.ok(goal.includes('The Stoic'));
    assert.ok(goal.includes('Omar'));
    assert.ok(goal.includes('follow-up check-in'));
    assert.ok(goal.includes('verify execution evidence'));
    assert.ok(goal.includes('non-clinical'));
    assert.ok(goal.includes('medical, legal, financial, or crisis advice'));
  });
});

test('Structured extraction schema & honest simulation boundary', async (t) => {
  await t.test('12. kickoff extraction yields structured action items and simulation notice', () => {
    const result = simulateExtraction({
      sessionMode: 'kickoff',
      coachRole: 'The Clarifier',
      userName: 'Omar',
    });

    assert.equal(result.status, 'simulated_completed');
    assert.equal(result.coach, 'The Clarifier');
    assert.equal(result.client, 'Omar');
    assert.ok(Array.isArray(result.actionItems));
    assert.ok(result.actionItems.length > 0);
    assert.ok(result.actionItems[0].task);
    assert.ok(result.actionItems[0].deadline);
    assert.ok(result.actionItems[0].priority);
    assert.ok(result.simulationNotice);
    assert.ok(result.simulationNotice.includes('host'));
    assert.equal(result.relentlessAccountabilityLoop, undefined); // No false claim of armed recurring scheduler
  });

  await t.test('followup extraction records milestone reconciliation and awards XP', () => {
    const result = simulateExtraction({
      sessionMode: 'followup',
      coachRole: 'The Clarifier',
      userName: 'Omar',
    });

    assert.equal(result.status, 'simulated_verified_completed');
    assert.equal(result.callType, 'accountability_verification');
    assert.ok(result.reconciledMilestone);
    assert.ok(result.momentumScoreAwarded.includes('XP'));
    assert.ok(result.streakLevel.includes('Active'));
    assert.ok(result.simulationNotice);
    assert.ok(result.simulationNotice.includes('host'));
  });
});
