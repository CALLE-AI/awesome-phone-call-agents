import type { ClaimOutcome, VerifyInput } from './types.ts';

export const FIXTURE_KINDS = ['clean_paid', 'clean_denied', 'fabricated_amount', 'wrong_department', 'never_asked', 'route_mismatch', 'missing_route_receipt', 'low_confidence'] as const;
export type FixtureKind = typeof FIXTURE_KINDS[number];

export function makeFixture(kind: FixtureKind, index = 0): { expectedAutoAccept: boolean; input: VerifyInput } {
  const claimReference = String(4400 + index);
  const paidAmount = `$${(1200 + index).toLocaleString('en-US')}`;
  const question = `What is the current status of claim ${claimReference}?`;
  const department = kind === 'wrong_department' ? 'Provider services department.' : 'Claims status department.';
  const answer = kind === 'clean_denied'
    ? `Claim ${claimReference} is denied under code CO-16. Please submit the missing report.`
    : `Claim ${claimReference} was paid ${paidAmount} on August 12, 2026.`;
  const outcome: ClaimOutcome = kind === 'clean_denied'
    ? { claimReference, status: 'denied', department: 'claims status department', denialCode: 'CO-16', nextAction: 'Submit missing report', evidence: { destination: department, question, answer } }
    : { claimReference, status: 'paid', department: 'claims status department', paidAmount: kind === 'fabricated_amount' ? `$${(1380 + index).toLocaleString('en-US')}` : paidAmount, paymentDate: '2026-08-12', nextAction: 'Post payment', evidence: { destination: department, question, answer } };

  return {
    expectedAutoAccept: kind === 'clean_paid' || kind === 'clean_denied',
    input: {
      call: {
        id: `fixture_${kind}_${index}`,
        status: 'completed',
        completion_confidence: { score: kind === 'low_confidence' ? 0.31 : 0.94 },
        recipients: [{ attempts: [{ transcript_turns: [
          { offset_seconds: 0, speaker: 'bot', text: 'Hello, I am an automated assistant calling about a fictional claim.' },
          { offset_seconds: 7, speaker: 'user', text: department },
          ...(kind === 'never_asked' ? [] : [{ offset_seconds: 11, speaker: 'bot', text: question }]),
          { offset_seconds: 17, speaker: 'user', text: answer },
        ] }] }],
      },
      outcome,
      expectedClaimReference: claimReference,
      expectedDepartment: 'claims status department',
      reportedKeys: ['2', '1'],
      ...(kind === 'missing_route_receipt' ? {} : { routeReceipt: { source: 'fixture_log' as const, keys: kind === 'route_mismatch' ? ['2', '3'] : ['2', '1'] } }),
    },
  };
}
