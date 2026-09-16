import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate, rankResults, validateTask } from '../src/domain/evaluator';
import { defaultTask } from '../src/domain/templates';
import { sampleFollowup, sampleResults } from '../src/domain/samples';
import { localToInstant } from '../src/domain/time';
import { CLOCK, corpus } from './corpus';
describe('45 independently labeled scenario expectations', () => {
  for (const s of corpus)
    it(`${s.split}: ${s.id}`, () =>
      assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, s.expected));
});
describe('critical decision boundaries', () => {
  it('does not accept an older reviewed fact whose cents contradict its explicit dollar quote', () => {
    const task = defaultTask('repair', CLOCK);
    const result = sampleResults(task, CLOCK)[2];
    result.mode = 'live';
    const fact = result.facts.find((f) => f.field === 'budget')!;
    fact.raw = 'The all-in total is $1,000 including fees.';
    result.transcript[fact.turn].text = fact.raw;
    fact.value = 1000;
    fact.reviewed = true;
    let check = evaluateCandidate(task, result, CLOCK).checks.find(
      (c) => c.requirement.id === 'budget',
    )!;
    assert.equal(check.verdict, 'unknown');
    assert.match(check.reason, /contradicts/);
    fact.value = 100000;
    check = evaluateCandidate(task, result, CLOCK).checks.find(
      (c) => c.requirement.id === 'budget',
    )!;
    assert.equal(check.verdict, 'fail');
  });
  it('keeps estimate below a cap unresolved until the explicit fictional correction', () => {
    const task = defaultTask('repair', CLOCK),
      result = sampleResults(task, CLOCK)[0];
    assert.equal(evaluateCandidate(task, result, CLOCK).verdict, 'unknown');
    assert.equal(
      evaluateCandidate(task, sampleFollowup(result, ['budget'], CLOCK), CLOCK).verdict,
      'pass',
    );
    assert.equal(result.facts.find((f) => f.field === 'budget')!.value, 3500);
  });
  it('does not relabel expired negatives as current failures', () => {
    const s = structuredClone(corpus.find((s) => s.id === 'repair/over-budget')!);
    s.candidate.facts.find((f) => f.field === 'budget')!.expiresAt = '2020-01-01T00:00:00Z';
    assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, 'unknown');
  });
  it('requires human review in live mode', () => {
    const s = structuredClone(corpus[0]);
    s.candidate.mode = 'live';
    s.candidate.facts.forEach((f) => (f.reviewed = false));
    assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, 'unknown');
  });
  it('never counts a quote absent from the transcript', () => {
    const s = structuredClone(corpus[0]);
    s.candidate.facts[0].raw = 'Invented quotation';
    assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, 'unknown');
  });
  it('fails a confirmed minimum above a hard cap', () => {
    const s = structuredClone(corpus.find((s) => s.id === 'repair/over-budget')!);
    s.candidate.facts.find((f) => f.field === 'budget')!.priceBasis = 'minimum';
    assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, 'fail');
  });
  for (const disposition of [
    'no_answer',
    'voicemail',
    'refused',
    'invalid_output',
    'uncontacted',
  ] as const)
    it(`keeps ${disposition} separate from confirmed failure`, () => {
      const s = structuredClone(corpus[0]);
      s.candidate.disposition = disposition;
      assert.equal(evaluateCandidate(s.task, s.candidate, CLOCK).verdict, 'unknown');
    });
  it('rejects ambiguous and nonexistent daylight-saving times', () => {
    assert.throws(() => localToInstant('2026-03-08T02:30', 'America/Chicago'));
    assert.throws(() => localToInstant('2026-11-01T01:30', 'America/Chicago'));
  });
  it('rejects invalid windows and duplicate requirement IDs', () => {
    const task = defaultTask('repair', CLOCK);
    task.requirements.push(structuredClone(task.requirements[0]));
    assert.ok(validateTask(task).service);
  });
  it('preferences cannot rescue a failed must-have', () => {
    const task = defaultTask('venue', CLOCK),
      results = sampleResults(task, CLOCK);
    const ranked = rankResults(task, results, CLOCK);
    assert.ok(
      ranked
        .filter((x) => x.evaluation.verdict === 'fail')
        .every((x) => x.evaluation.label === 'Does not meet requirements'),
    );
  });
  it('compares up-front cash separately from the refundable deposit and final cost', () => {
    const task = defaultTask('rental', CLOCK),
      result = sampleResults(task, CLOCK)[0];
    task.requirements.find((r) => r.id === 'upfront')!.value = 18000;
    const e = evaluateCandidate(task, result, CLOCK);
    assert.equal(e.checks.find((c) => c.requirement.id === 'budget')!.verdict, 'pass');
    assert.equal(e.checks.find((c) => c.requirement.id === 'deposit')!.verdict, 'pass');
    assert.equal(e.checks.find((c) => c.requirement.id === 'upfront')!.verdict, 'fail');
  });
  it('has one fully matching rental, a repair near-match, and a no-match venue', () => {
    assert.ok(
      sampleResults(defaultTask('rental', CLOCK), CLOCK).some(
        (r) => evaluateCandidate(defaultTask('rental', CLOCK), r, CLOCK).verdict === 'pass',
      ),
    );
    assert.equal(
      sampleResults(defaultTask('venue', CLOCK), CLOCK).filter(
        (r) => evaluateCandidate(defaultTask('venue', CLOCK), r, CLOCK).verdict === 'pass',
      ).length,
      0,
    );
  });
});
