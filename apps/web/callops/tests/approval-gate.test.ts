import { describe, expect, it } from 'vitest';

import { fingerprintPlan } from '../src/domain/canonical';
import { transitionRun } from '../src/domain/state-machine';
import { createHarness, prepareApproved, preparePlan } from './helpers';

describe('human approval gate', () => {
  it('refuses a simulation without approval', async () => {
    const { service } = createHarness();
    await preparePlan(service);

    await expect(service.startApprovedSimulation()).rejects.toMatchObject({
      code: 'APPROVAL_GATE_CLOSED',
    });
  });

  it('keeps the provider boundary closed after rejection', async () => {
    const { service } = createHarness();
    await preparePlan(service);
    const rejected = await service.recordApproval('REJECTED', []);

    expect(rejected.run?.state).toBe('REJECTED');
    await expect(service.startApprovedSimulation()).rejects.toMatchObject({
      code: 'APPROVAL_GATE_CLOSED',
    });
  });

  it('invalidates approval automatically when the plan changes', async () => {
    const { service } = createHarness();
    const approved = await prepareApproved(service);
    const oldFingerprint = approved.approval?.planFingerprint;

    const revised = await service.revisePlan((plan) => ({
      ...plan,
      plannedQuestions: [...plan.plannedQuestions, 'Is a synthetic status code available?'],
    }));

    expect(revised.approval).toBeNull();
    expect(revised.run?.state).toBe('WAITING_FOR_APPROVAL');
    expect(revised.audit.at(-1)?.event).toBe('APPROVAL_INVALIDATED');
    expect(revised.plan === null ? null : await fingerprintPlan(revised.plan)).not.toBe(oldFingerprint);
  });

  it('refuses a mismatched approval fingerprint', async () => {
    const { service, repository } = createHarness();
    const approved = await prepareApproved(service);
    if (approved.approval === null) throw new Error('Approval missing in test setup.');
    await repository.save({
      ...approved,
      approval: {
        ...approved.approval,
        planFingerprint: '0'.repeat(64),
      },
    });

    await expect(service.startApprovedSimulation()).rejects.toMatchObject({
      code: 'FINGERPRINT_MISMATCH',
    });
  });

  it('refuses approval when the exact transmitted data is not confirmed', async () => {
    const { service } = createHarness();
    await preparePlan(service);

    await expect(service.recordApproval('APPROVED', [])).rejects.toMatchObject({
      code: 'TRANSMITTED_DATA_NOT_CONFIRMED',
    });
  });

  it('rejects invalid call-run state transitions', () => {
    expect(() =>
      transitionRun(
        {
          id: 'run-demo',
          caseId: 'case-demo',
          planId: 'plan-demo',
          scenario: 'NOMINAL',
          provider: 'MOCK',
          state: 'DRAFT',
          providerRunId: null,
          transcript: [],
          retryScheduled: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        'COMPLETED',
        '2026-01-01T00:00:01.000Z',
      ),
    ).toThrow(/Transition refused/);
  });


});
