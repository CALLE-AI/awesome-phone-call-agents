import test from 'node:test';
import assert from 'node:assert/strict';
import { providerResult } from '../lib/domain.ts';
const phone = '+12025550100';
const result = {
  outcome: 'confirmed_window',
  window: '2026-09-10 15:00–16:00 Asia/Kolkata',
  evidence: 'Yes, three to four works.',
};
const call = () => ({
  status: 'completed',
  structured_result: { outcome: 'confirmed_window', window: 'wrong aggregate' },
  recipients: [
    {
      phones: [phone],
      structured_result: result,
      attempts: [
        {
          transcript_turns: [
            { speaker: 'user', text: 'Yes, three to four works.' },
          ],
        },
      ],
    },
  ],
});
test('completed execution without result keeps polling', () =>
  assert.equal(
    providerResult(
      { status: 'completed', recipients: [{ structured_result: null }] },
      phone,
    ),
    null,
  ));
test('recipient result takes priority over aggregate', () =>
  assert.deepEqual(providerResult(call(), phone), result));
test('invented evidence cannot confirm a window', () => {
  const d = call();
  d.recipients[0].structured_result = { ...result, evidence: 'Invented quote' };
  assert.equal(providerResult(d, phone).outcome, 'ambiguous');
});
test('agent speech cannot support customer confirmation', () => {
  const d = call();
  d.recipients[0].attempts[0].transcript_turns[0].speaker = 'bot';
  assert.equal(providerResult(d, phone).outcome, 'ambiguous');
});
test('wrong recipient rejected', () => {
  const d = call();
  d.recipients[0].phones = ['+12025550199'];
  assert.equal(providerResult(d, phone).outcome, 'ambiguous');
});
test('failure cannot claim success', () => {
  const d = call();
  d.status = 'failed';
  assert.equal(providerResult(d, phone).outcome, 'ambiguous');
});
