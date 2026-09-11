const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidE164,
  maskPhone,
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
  });
});

test('Privacy and PII phone masking', async (t) => {
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
});

test('Call goal prompt compilation', async (t) => {
  await t.test('compiles momentum kickoff goal with coach role and client context', () => {
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
  });

  await t.test('compiles closed-loop followup accountability check-in', () => {
    const goal = buildCallGoal({
      coachRole: 'The Stoic',
      userName: 'Omar',
      sessionMode: 'followup',
    });

    assert.ok(goal.includes('The Stoic'));
    assert.ok(goal.includes('Omar'));
    assert.ok(goal.includes('follow-up check-in'));
    assert.ok(goal.includes('verify execution evidence'));
  });
});

test('Structured extraction schema verification', async (t) => {
  await t.test('kickoff extraction yields structured action items and callback trigger', () => {
    const result = simulateExtraction({
      sessionMode: 'kickoff',
      coachRole: 'The Clarifier',
      userName: 'Omar',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.coach, 'The Clarifier');
    assert.equal(result.client, 'Omar');
    assert.ok(Array.isArray(result.actionItems));
    assert.ok(result.actionItems.length > 0);
    assert.ok(result.actionItems[0].task);
    assert.ok(result.actionItems[0].deadline);
    assert.ok(result.actionItems[0].priority);
    assert.ok(result.relentlessAccountabilityLoop);
    assert.equal(result.relentlessAccountabilityLoop.status, 'armed');
  });

  await t.test('followup extraction records milestone reconciliation and awards XP', () => {
    const result = simulateExtraction({
      sessionMode: 'followup',
      coachRole: 'The Clarifier',
      userName: 'Omar',
    });

    assert.equal(result.status, 'verified_completed');
    assert.equal(result.callType, 'accountability_verification');
    assert.ok(result.reconciledMilestone);
    assert.ok(result.momentumScoreAwarded.includes('XP'));
    assert.ok(result.streakLevel.includes('Active'));
  });
});
