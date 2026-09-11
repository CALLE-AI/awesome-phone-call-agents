import type { CallRecord, Check, ClaimOutcome, Verification, VerifyInput } from './types.ts';

const STATUS_WORDS: Record<ClaimOutcome['status'], string[]> = {
  paid: ['paid', 'payment issued', 'processed for payment'],
  pending: ['pending', 'in process', 'under review'],
  denied: ['denied', 'denial'],
  rejected: ['rejected', 'rejection'],
  needs_information: ['needs information', 'additional information', 'missing information'],
  not_found: ['not found', 'no record', 'cannot locate'],
  unknown: ['unknown', 'unable to determine', 'could not confirm'],
};

export function verifyClaimOutcome(input: VerifyInput): Verification {
  const checks: Check[] = [];
  const turns = allTurns(input.call);
  const payerTurns = turns.filter((turn) => turn.speaker !== 'bot');
  const agentTurns = turns.filter((turn) => turn.speaker === 'bot');
  const payerText = payerTurns.map((turn) => turn.text).join(' ');
  const agentText = agentTurns.map((turn) => turn.text).join(' ');
  const confidence = input.call.completion_confidence?.score;
  const minConfidence = input.minConfidence ?? 0.6;
  const reached = String(input.call.status ?? '').toLowerCase() === 'completed' && payerTurns.length > 0;

  required(checks, 'payer response present', reached, reached ? `${payerTurns.length} payer-side transcript turns` : 'no completed payer response');
  if (!reached) return finish('unreachable', checks, 'No payer response exists to verify.');

  const expectedReference = canonicalReference(input.expectedClaimReference);
  const resultReference = canonicalReference(input.outcome.claimReference);
  const referenceBound = Boolean(expectedReference) && expectedReference === resultReference && referenceInClaimContext(payerText, expectedReference);
  required(checks, 'claim reference bound', referenceBound, referenceBound ? `payer repeated claim ${maskReference(expectedReference)}` : 'result is not bound to the requested claim');

  const questionGrounded = quoteInTurns(input.outcome.evidence.question, agentTurns.map((turn) => turn.text));
  const questionSpecific = referenceInClaimContext(agentText, expectedReference) && /\b(status|paid|payment|denied|claim)\b/i.test(input.outcome.evidence.question);
  required(checks, 'question was actually asked', questionGrounded && questionSpecific, questionGrounded && questionSpecific ? 'agent transcript contains the claim-specific question' : 'required question is absent from the agent transcript');

  const destinationGrounded = quoteInTurns(input.outcome.evidence.destination, payerTurns.map((turn) => turn.text));
  const destinationMatches = destinationGrounded && contentWords(input.expectedDepartment).every((word) => normalise(input.outcome.evidence.destination).includes(word));
  required(checks, 'claims department established', destinationMatches, destinationMatches ? `payer identified ${input.outcome.department}` : 'no payer quote establishes the intended department');

  const answerGrounded = quoteInTurns(input.outcome.evidence.answer, payerTurns.map((turn) => turn.text));
  required(checks, 'answer quote grounded', answerGrounded, answerGrounded ? 'exact evidence quote appears on the payer side' : 'answer quote is absent from payer transcript');

  const statusSupported = STATUS_WORDS[input.outcome.status].some((phrase) => normalise(input.outcome.evidence.answer).includes(normalise(phrase)));
  required(checks, 'claim status supported', statusSupported, statusSupported ? `payer evidence supports ${input.outcome.status}` : `payer evidence does not support ${input.outcome.status}`);

  if (input.outcome.paidAmount) {
    const amount = canonicalNumber(input.outcome.paidAmount);
    const ok = Boolean(amount) && numbersIn(input.outcome.evidence.answer).has(amount);
    required(checks, 'paid amount supported', ok, ok ? `amount ${input.outcome.paidAmount} occurs in the payer quote` : `amount ${input.outcome.paidAmount} is not in the payer quote`);
  }
  if (input.outcome.paymentDate) {
    const ok = supportsDate(input.outcome.paymentDate, input.outcome.evidence.answer);
    required(checks, 'payment date supported', ok, ok ? `date ${input.outcome.paymentDate} is grounded` : `date ${input.outcome.paymentDate} is not grounded`);
  }
  if (input.outcome.denialCode) {
    const ok = normalise(input.outcome.evidence.answer).includes(normalise(input.outcome.denialCode));
    required(checks, 'denial code supported', ok, ok ? `denial code ${input.outcome.denialCode} is grounded` : `denial code ${input.outcome.denialCode} is not grounded`);
  }

  if (input.outcome.nextAction) {
    const actionWords = contentWords(input.outcome.nextAction);
    const ok = actionWords.length > 0 && actionWords.every((word) => normalise(input.outcome.evidence.answer).includes(word));
    checks.push({ name: 'next action provenance', passed: ok, severity: 'corroborating', detail: ok ? 'payer evidence contains the action' : 'operator-policy recommendation; not payer testimony' });
  }

  const routePresent = Boolean(input.routeReceipt);
  required(checks, 'independent route receipt', routePresent, routePresent ? `receipt supplied by ${input.routeReceipt!.source}` : 'model-reported route has no independent witness');
  if (input.routeReceipt) {
    const ok = arraysEqual(input.reportedKeys, input.routeReceipt.keys);
    required(checks, 'keypress trail matches', ok, ok ? `independent trail ${input.routeReceipt.keys.join(' -> ')}` : `reported ${input.reportedKeys.join(' -> ')}, receipt ${input.routeReceipt.keys.join(' -> ')}`);
  }

  const confidenceOk = confidence === undefined || confidence >= minConfidence;
  checks.push({ name: 'CALL-E confidence', passed: confidenceOk, severity: 'corroborating', detail: confidence === undefined ? 'provider confidence unavailable' : `${confidence.toFixed(2)} against ${minConfidence.toFixed(2)} floor` });

  const failed = checks.filter((check) => check.severity === 'required' && !check.passed);
  if (failed.length === 0 && confidenceOk) return finish('verified', checks, 'Transcript, destination, claim fields, and independent route receipt agree.');
  const contradictions = new Set(['claim reference bound', 'claims department established', 'claim status supported', 'paid amount supported', 'payment date supported', 'denial code supported', 'keypress trail matches']);
  const verdict = failed.some((check) => contradictions.has(check.name)) ? 'contradicted' : 'needs_review';
  return finish(verdict, checks, verdict === 'contradicted' ? 'Witnesses conflict. Do not write this result to the claim record.' : 'Evidence is incomplete. A biller must review this result.');
}

export function outcomeFromCall(call: CallRecord): { outcome: ClaimOutcome; reportedKeys: string[] } {
  const source = (call.structured_result && Object.keys(call.structured_result).length > 0)
    ? call.structured_result
    : (call.recipients?.[0]?.structured_result ?? {});
  const levels = Array.isArray(source.menu_levels) ? source.menu_levels as Array<Record<string, unknown>> : [];
  return {
    outcome: {
      claimReference: String(source.claim_reference ?? ''),
      status: String(source.claim_status ?? 'unknown') as ClaimOutcome['status'],
      department: String(source.target_name_used ?? ''),
      ...(source.paid_amount ? { paidAmount: String(source.paid_amount) } : {}),
      ...(source.payment_date ? { paymentDate: String(source.payment_date) } : {}),
      ...(source.denial_code ? { denialCode: String(source.denial_code) } : {}),
      ...(source.next_action ? { nextAction: String(source.next_action) } : {}),
      evidence: {
        destination: String(source.department_evidence ?? ''),
        question: String(source.question_evidence ?? ''),
        answer: String(source.answer_evidence ?? ''),
      },
    },
    reportedKeys: levels.filter((level) => level.action_type === 'dtmf').map((level) => String(level.action_value ?? '')),
  };
}

function allTurns(call: CallRecord) { return (call.recipients ?? []).flatMap((recipient) => (recipient.attempts ?? []).flatMap((attempt) => attempt.transcript_turns ?? [])).sort((a, b) => a.offset_seconds - b.offset_seconds); }
function finish(verdict: Verification['verdict'], checks: Check[], summary: string): Verification { return { verdict, checks, autoAccept: verdict === 'verified', summary }; }
function required(checks: Check[], name: string, passed: boolean, detail: string) { checks.push({ name, passed, severity: 'required', detail }); }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function contentWords(value: string) { const ignored = new Set(['the', 'a', 'an', 'of', 'for']); return normalise(value).split(' ').filter((word) => word.length > 2 && !ignored.has(word)); }
function quoteInTurns(quote: string, turns: string[]) { const needle = normalise(quote); return needle.length >= 4 && turns.some((turn) => normalise(turn).includes(needle)); }
function canonicalNumber(value: string) { const clean = value.replace(/[^0-9.]/g, ''); const parsed = Number(clean); return Number.isFinite(parsed) ? String(parsed) : ''; }
function canonicalReference(value: string) { return value.replace(/\D/g, ''); }
function numbersIn(value: string) { return new Set([...value.matchAll(/(?:\$\s*)?\d[\d,]*(?:\.\d+)?/g)].map((match) => canonicalNumber(match[0]))); }
function referenceInClaimContext(text: string, expected: string) { const windows = text.match(/\b(?:claim|reference)\b[^.!?\n]{0,80}/gi) ?? []; return windows.some((window) => (window.match(/\d(?:[\d\s-]*\d)?/g) ?? []).some((run) => run.replace(/\D/g, '') === expected)); }
function maskReference(value: string) { return value.length <= 4 ? value : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`; }
function arraysEqual(a: string[], b: string[]) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function supportsDate(iso: string, evidence: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); if (!match) return normalise(evidence).includes(normalise(iso)); const months = ['january','february','march','april','may','june','july','august','september','october','november','december']; return normalise(evidence).includes(months[Number(match[2]) - 1] ?? '') && numbersIn(evidence).has(String(Number(match[3]))) && numbersIn(evidence).has(match[1]); }
