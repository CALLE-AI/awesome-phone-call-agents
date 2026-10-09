import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTask } from '../src/domain/templates';
import { sampleResults, sampleFollowup } from '../src/domain/samples';
import { evaluateCandidate } from '../src/domain/evaluator';
import {
  whatWouldWork,
  previewLimits,
  nextUsefulQuestion,
  bestNextQuestion,
} from '../src/domain/decisions';
const now = new Date('2026-09-09T19:00:00Z');
const repair = () => {
  const task = defaultTask('repair', now);
  return { task, results: sampleResults(task, now) };
};

describe('evidence-backed decision alternatives', () => {
  it('previews the smallest confirmed budget increase without mutating requirements or evidence', () => {
    const { task, results } = repair();
    const candidate = results[2];
    const before = JSON.stringify({ task, candidate });
    const option = whatWouldWork(task, candidate, now)!;
    assert.deepEqual(
      option.changes.map((c) => [c.field, c.from, c.to]),
      [['budget', 4000, 4500]],
    );
    const preview = previewLimits(task, candidate, option, {}, now);
    assert.equal(preview.evaluation.verdict, 'pass');
    assert.equal(evaluateCandidate(task, candidate, now).verdict, 'fail');
    assert.equal(JSON.stringify({ task, candidate }), before);
    assert.equal(
      previewLimits(task, candidate, option, { budget: 4499 }, now).evaluation.verdict,
      'fail',
    );
    assert.equal(previewLimits(task, candidate, option, { budget: NaN }, now).valid, false);
    assert.equal(previewLimits(task, candidate, option, { budget: 3999 }, now).valid, false);
  });
  it('never offers an estimate, minimum, conditional, conflicting, unsupported, stale or unreviewed quote as a confirmed trade-off', () => {
    const { task, results } = repair();
    for (const mutate of [
      (c: (typeof results)[number]) => {
        c.facts.find((f) => f.field === 'budget')!.priceBasis = 'estimate';
      },
      (c: (typeof results)[number]) => {
        c.facts.find((f) => f.field === 'budget')!.priceBasis = 'minimum';
      },
      (c: (typeof results)[number]) => {
        c.facts.find((f) => f.field === 'budget')!.conditions = ['subject to inspection'];
      },
      (c: (typeof results)[number]) => {
        c.facts.find((f) => f.field === 'budget')!.expiresAt = now.toISOString();
      },
      (c: (typeof results)[number]) => {
        c.mode = 'live';
        c.facts.forEach((f) => (f.reviewed = false));
      },
      (c: (typeof results)[number]) => {
        c.transcript = [];
      },
      (c: (typeof results)[number]) => {
        c.facts.push({
          ...c.facts.find((f) => f.field === 'budget')!,
          id: 'conflict',
          value: 5000,
        });
      },
    ]) {
      const candidate = structuredClone(results[2]);
      mutate(candidate);
      assert.equal(whatWouldWork(task, candidate, now), null);
    }
    assert.equal(whatWouldWork(task, results[1], now), null); // incompatible service
  });
  it('respects original scope and expiry during preview instead of making evidence reusable', () => {
    const { task, results } = repair();
    const candidate = results[2];
    candidate.facts.find((f) => f.field === 'budget')!.scope.budget = 4000;
    assert.equal(whatWouldWork(task, candidate, now), null);
    delete candidate.facts.find((f) => f.field === 'budget')!.scope.budget;
    const option = whatWouldWork(task, candidate, now)!;
    assert.equal(
      previewLimits(task, candidate, option, {}, new Date(now.getTime() + 86400001)).evaluation
        .verdict,
      'unknown',
    );
    const changed = structuredClone(task);
    changed.requirements.find((r) => r.id === 'deadline')!.value = '2026-09-12T23:00:00Z';
    assert.equal(whatWouldWork(changed, candidate, now), null);
  });
  it('keeps refundable deposit, total price and derived up-front cash as separate limits', () => {
    const task = defaultTask('rental', now);
    const candidate = sampleResults(task, now)[0];
    task.requirements.find((r) => r.id === 'budget')!.value = 8000;
    task.requirements.find((r) => r.id === 'deposit')!.value = 9000;
    task.requirements.find((r) => r.id === 'upfront')!.value = 17000;
    const option = whatWouldWork(task, candidate, now)!;
    assert.deepEqual(
      option.changes.map((c) => [c.field, c.to]),
      [
        ['budget', 8500],
        ['deposit', 10000],
        ['upfront', 18500],
      ],
    );
    assert.equal(previewLimits(task, candidate, option, {}, now).evaluation.verdict, 'pass');
  });
});

describe('the next useful question', () => {
  it('chooses the unresolved all-in price and stops recommending after the supported correction', () => {
    const { task, results } = repair();
    const best = bestNextQuestion(task, results, now)!;
    assert.equal(best.candidate.id, 'repair-1');
    assert.equal(best.advice.field, 'budget');
    assert.equal(best.advice.decisive, true);
    results[0] = sampleFollowup(results[0], ['budget'], now);
    assert.equal(nextUsefulQuestion(task, results[0], now).kind, 'none');
    assert.equal(bestNextQuestion(task, results, now), null);
  });
  it('does not recommend repeat calls after refusal, no answer, or an empty factual result', () => {
    const { task, results } = repair();
    const c = results[0];
    for (const disposition of ['refused', 'no_answer', 'voicemail', 'uncontacted'] as const) {
      assert.equal(nextUsefulQuestion(task, { ...c, disposition }, now).kind, 'none');
    }
    assert.equal(nextUsefulQuestion(task, { ...c, facts: [] }, now).kind, 'review');
    assert.equal(nextUsefulQuestion(task, results[1], now).kind, 'none');
    assert.equal(nextUsefulQuestion(task, results[2], now).kind, 'none');
  });
  it('requires evidence review before asking again and never offers an automated judgment for manual requirements', () => {
    const { task, results } = repair();
    const c = results[0];
    c.mode = 'live';
    c.facts.forEach((f) => (f.reviewed = false));
    assert.equal(nextUsefulQuestion(task, c, now).kind, 'review');
    c.mode = 'sample';
    task.requirements.push({
      id: 'custom1',
      label: 'Personal judgment',
      kind: 'manual',
      importance: 'must',
      unit: 'none',
      value: 'Suitable for me',
      question: 'Describe suitability',
    });
    assert.equal(nextUsefulQuestion(task, c, now).kind, 'review');
  });
  it('does not ask a redundant cash-total question when the missing deposit determines it', () => {
    const task = defaultTask('rental', now);
    const c = sampleResults(task, now)[0];
    c.facts = c.facts.filter((f) => f.field !== 'deposit');
    const advice = nextUsefulQuestion(task, c, now);
    assert.equal(advice.kind, 'ask');
    if (advice.kind === 'ask') {
      assert.equal(advice.field, 'deposit');
      assert.equal(advice.remaining, 1);
      assert.equal(advice.decisive, true);
    }
  });
});
