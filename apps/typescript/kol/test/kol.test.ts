import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../src/eval.ts';
import { FIXTURE_KINDS, makeFixture } from '../src/fixtures.ts';
import { verifyClaimOutcome } from '../src/verify.ts';

for (const kind of FIXTURE_KINDS) {
  test(`witness gate: ${kind}`, () => {
    const fixture = makeFixture(kind, 17);
    assert.equal(verifyClaimOutcome(fixture.input).autoAccept, fixture.expectedAutoAccept);
  });
}

test('correct financial values from the wrong department are contradicted', () => {
  const result = verifyClaimOutcome(makeFixture('wrong_department', 19).input);
  assert.equal(result.verdict, 'contradicted');
  assert.equal(result.checks.find((check) => check.name === 'paid amount supported')?.passed, true);
  assert.equal(result.checks.find((check) => check.name === 'claims department established')?.passed, false);
});

test('model-reported keypresses cannot substitute for an independent receipt', () => {
  const result = verifyClaimOutcome(makeFixture('missing_route_receipt', 23).input);
  assert.equal(result.autoAccept, false);
});

test('leading-zero claim references do not collide', () => {
  const fixture = makeFixture('clean_paid', 25);
  fixture.input.expectedClaimReference = '004425';
  fixture.input.outcome.claimReference = '4425';
  assert.equal(verifyClaimOutcome(fixture.input).autoAccept, false);
});

test('payment year must be spoken by the payer', () => {
  const fixture = makeFixture('clean_paid', 26);
  fixture.input.outcome.paymentDate = '2025-08-12';
  assert.equal(verifyClaimOutcome(fixture.input).autoAccept, false);
});

test('640-case corpus has no unsafe auto-accepts', () => {
  const metrics = evaluate();
  assert.equal(metrics.cases, 640);
  assert.equal(metrics.safeAccepted, 160);
  assert.equal(metrics.unsafeWithheld, 480);
  assert.equal(metrics.unsafeAccepted, 0);
});
