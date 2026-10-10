import test from 'node:test';
import assert from 'node:assert/strict';
import { approve, canRun, confirm, normalizeResult } from '../lib/domain.ts';
const base = () => ({
  id: 'test',
  state: 'awaiting_approval',
  expires: new Date(Date.now() + 60000).toISOString(),
  audit: [],
});
test('approval required before execution', () =>
  assert.throws(() => canRun(base()), /Approve/));
test('expired approval rejected', () =>
  assert.throws(
    () => approve({ ...base(), expires: '2000-01-01' }),
    /expired/,
  ));
test('existing call cannot be dialed again', () =>
  assert.throws(
    () => canRun({ ...approve(base()), runId: 'existing' }),
    /already exists/,
  ));
test('missing evidence demotes confirmation', () =>
  assert.equal(
    normalizeResult({ outcome: 'confirmed_window', window: 'tomorrow' })
      .outcome,
    'ambiguous',
  ));
test('callback is not a booking', () =>
  assert.throws(
    () =>
      confirm({
        ...base(),
        state: 'needs_review',
        result: {
          outcome: 'callback_requested',
          window: 'tomorrow',
          evidence: 'call back',
        },
      }),
    /clear/,
  ));
test('accepted window is not completed pickup', () =>
  assert.equal(
    confirm({
      ...base(),
      state: 'needs_review',
      result: {
        outcome: 'confirmed_window',
        window: 'tomorrow 3 pm',
        evidence: 'yes',
      },
    }).state,
    'window_accepted',
  ));
test('unknown provider output is ambiguous', () =>
  assert.equal(normalizeResult({ outcome: 'invented' }).outcome, 'ambiguous'));
