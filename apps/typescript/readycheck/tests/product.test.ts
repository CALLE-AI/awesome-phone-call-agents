import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTask, withAcquisition } from '../src/domain/templates';
import { sampleBaseline, sampleResults } from '../src/domain/samples';
import { evaluateCandidate, validateTask } from '../src/domain/evaluator';
import { taskSchema } from '../src/domain/model';
const now = new Date('2026-09-09T14:00:00Z');

describe('purchase and explicit alternatives', () => {
  it('checks purchases without rental deposits and preserves the mode on schema parsing', () => {
    const task = withAcquisition(defaultTask('rental', now), 'purchase');
    task.requirements.find((r) => r.id === 'budget')!.value = 120000;
    assert.equal(taskSchema.parse(task).acquisition, 'purchase');
    assert.deepEqual(validateTask(task), {});
    assert.equal(
      task.requirements.some((r) => ['deposit', 'upfront'].includes(r.id)),
      false,
    );
    const result = sampleResults(sampleBaseline('rental', now.toISOString(), task), now)[0];
    assert.equal(evaluateCandidate(task, result, now).verdict, 'pass');
  });
  it('rental evidence cannot establish a purchase or vice versa', () => {
    const rental = defaultTask('rental', now),
      purchase = withAcquisition(rental, 'purchase');
    assert.equal(
      evaluateCandidate(purchase, sampleResults(rental, now)[0], now).verdict,
      'unknown',
    );
    assert.equal(
      evaluateCandidate(rental, sampleResults(purchase, now)[0], now).verdict,
      'unknown',
    );
  });
  it('old saved rental evidence remains usable for the original rental request', () => {
    const task = defaultTask('rental', now),
      result = sampleResults(task, now)[0];
    result.facts.forEach((fact) => delete fact.scope.$acquisition);
    assert.equal(evaluateCandidate(task, result, now).verdict, 'pass');
    assert.equal(
      evaluateCandidate(withAcquisition(task, 'purchase'), result, now).verdict,
      'unknown',
    );
  });
  it('only a deliberately accepted alternative can satisfy exact model identity', () => {
    const task = defaultTask('rental', now),
      result = sampleResults(task, now)[1];
    assert.equal(evaluateCandidate(task, result, now).verdict, 'fail');
    task.requirements.find((r) => r.id === 'item')!.alternatives = ['Epson EX3280'];
    const evaluation = evaluateCandidate(task, result, now);
    assert.equal(evaluation.verdict, 'pass');
    assert.match(
      evaluation.checks.find((c) => c.requirement.id === 'item')!.reason,
      /explicitly accepted/,
    );
  });
  it('accepting an alternate never transfers the primary model price to it', () => {
    const task = defaultTask('rental', now),
      result = sampleResults(task, now)[1];
    task.requirements.find((r) => r.id === 'item')!.alternatives = ['Epson EX3280'];
    result.facts.find((f) => f.field === 'budget')!.scope.item = 'Epson EB-FH52';
    const evaluation = evaluateCandidate(task, result, now);
    assert.equal(evaluation.verdict, 'unknown');
    assert.equal(evaluation.checks.find((c) => c.requirement.id === 'budget')!.verdict, 'unknown');
  });
  it('removing an accepted alternative recalculates to a failure', () => {
    const task = defaultTask('rental', now),
      result = sampleResults(task, now)[1];
    task.requirements.find((r) => r.id === 'item')!.alternatives = ['Epson EX3280'];
    assert.equal(evaluateCandidate(task, result, now).verdict, 'pass');
    task.requirements.find((r) => r.id === 'item')!.alternatives = [];
    assert.equal(evaluateCandidate(task, result, now).verdict, 'fail');
  });
  it('rejects duplicate alternatives, empty alternatives, and alternatives on money fields', () => {
    const task = defaultTask('rental', now),
      item = task.requirements.find((r) => r.id === 'item')!;
    item.alternatives = [' epson eb-fh52 '];
    assert.ok(validateTask(task).item);
    item.alternatives = [''];
    assert.ok(validateTask(task).item);
    item.alternatives = [];
    task.requirements.find((r) => r.id === 'budget')!.alternatives = ['free'];
    assert.ok(validateTask(task).budget);
  });
  it('switching back to rental restores required deposit checks without duplicating them', () => {
    const task = withAcquisition(withAcquisition(defaultTask('rental', now), 'purchase'), 'rental');
    assert.deepEqual(validateTask(task), {});
    assert.equal(
      withAcquisition(task, 'rental').requirements.filter((r) => r.id === 'deposit').length,
      1,
    );
  });
});
