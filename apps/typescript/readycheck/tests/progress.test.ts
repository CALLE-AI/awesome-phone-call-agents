import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkProgress, pendingFacts } from '../src/domain/progress';
import { defaultTask } from '../src/domain/templates';
import { sampleResults } from '../src/domain/samples';
import type { CaseRecord, Inquiry, Plan } from '../src/domain/model';

function fixture() {
  const now = new Date().toISOString();
  const task = defaultTask('repair');
  const record: CaseRecord = {
    id: 'case',
    title: 'Repair',
    mode: 'sample',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
    revisions: [{ version: 1, task, createdAt: now, results: [] }],
    outcomes: [],
    stopped: false,
  };
  return record;
}
function plans(state: Inquiry['state']): Plan[] {
  return [
    {
      id: 'plan',
      caseId: 'case',
      version: 1,
      mode: 'live',
      hash: 'hash',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      recipients: [],
      questions: [],
      disclosure: '',
      taskText: '',
      status: 'approved',
      inquiries: [
        {
          id: 'inquiry',
          candidateId: 'repair-1',
          state,
          vendorId: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ];
}
describe('product progress reflects evidence and recorded outcomes', () => {
  it('distinguishes a ready request, an in-progress inquiry and an uncertain start', () => {
    const record = fixture();
    assert.equal(checkProgress(record).phase, 'ready');
    assert.equal(checkProgress(record, plans('submitted')).phase, 'calling');
    assert.equal(checkProgress(record, plans('dispatch_unknown')).phase, 'attention');
    assert.equal(checkProgress(record, plans('failed')).phase, 'attention');
    record.stopped = true;
    assert.equal(
      checkProgress(record, plans('submitted')).phase,
      'calling',
      'stopping future work does not end a call',
    );
  });
  it('counts only unreviewed live answers and supports a no-fact call review', () => {
    const record = fixture();
    const result = sampleResults(record.revisions[0].task)[0];
    result.mode = 'live';
    result.inquiryId = 'inquiry';
    result.facts.forEach((f) => {
      f.reviewed = false;
    });
    record.revisions[0].results = [result];
    assert.equal(checkProgress(record).pendingAnswers, result.facts.length);
    assert.equal(checkProgress(record).phase, 'review');
    const original = result.facts[0];
    result.facts.push({ ...original, id: 'corrected', reviewed: true, supersedes: original.id });
    assert.equal(pendingFacts(result).length, result.facts.length - 2);
    result.facts.at(-1)!.rejected = true;
    assert.equal(pendingFacts(result).length, result.facts.length - 1);
    result.facts = [];
    assert.equal(checkProgress(record, plans('review_required')).phase, 'review');
    assert.equal(checkProgress(record, plans('evaluated')).phase, 'decision');
  });
  it('never equates a passing comparison, shortlist or arrangement with task completion', () => {
    const record = fixture();
    record.revisions[0].results = sampleResults(record.revisions[0].task);
    for (const state of ['selected', 'arrangement_confirmed'] as const) {
      record.outcomes = [
        {
          id: state,
          candidateId: 'repair-1',
          state,
          at: new Date().toISOString(),
          actor: 'user',
          note: '',
        },
      ];
      assert.equal(checkProgress(record).phase, 'decision');
    }
    record.outcomes.push({
      id: 'complete',
      candidateId: 'repair-1',
      state: 'completed',
      at: new Date().toISOString(),
      actor: 'user',
      note: '',
    });
    assert.equal(checkProgress(record).phase, 'completed');
    record.currentVersion = 2;
    record.revisions.push({
      ...structuredClone(record.revisions[0]),
      version: 2,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    assert.equal(
      checkProgress(record).phase,
      'decision',
      'a prior outcome does not complete revised requirements',
    );
  });
});
