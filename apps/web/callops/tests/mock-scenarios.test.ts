import { describe, expect, it } from 'vitest';

import { MockCallProvider } from '../src/adapters/mock-call-provider';
import { INDIRECT_INJECTION_FIXTURE } from '../src/fixtures/demo';
import { completeScenario, createHarness, prepareApproved, preparePlan } from './helpers';

describe('deterministic MockCallProvider scenarios', () => {
  it('returns the nominal replacement status without commitments', async () => {
    const { service } = createHarness();
    const result = await completeScenario(service, 'NOMINAL');

    expect(result.run?.state).toBe('COMPLETED');
    expect(result.outcome?.announcedDelay).toBe('3 to 5 business days');
    expect(result.outcome?.commitmentsMade).toEqual([]);
    expect(result.outcome?.humanDecisionRequired).toBe(false);
  });

  it('returns an ambiguous result requiring human follow-up', async () => {
    const { service } = createHarness();
    const result = await completeScenario(service, 'AMBIGUOUS');

    expect(result.run?.state).toBe('COMPLETED');
    expect(result.outcome?.announcedDelay).toBeNull();
    expect(result.outcome?.humanDecisionRequired).toBe(true);
    expect(result.outcome?.unconfirmedFacts.length).toBeGreaterThan(0);
  });

  it('fails without obtaining data or scheduling an automatic retry', async () => {
    const { service } = createHarness();
    const result = await completeScenario(service, 'FAILED');

    expect(result.run?.state).toBe('FAILED');
    expect(result.run?.retryScheduled).toBe(false);
    expect(result.outcome?.announcedDelay).toBeNull();
    await expect(service.advanceSimulation()).rejects.toMatchObject({
      code: 'APPROVAL_GATE_CLOSED',
    });
  });

  it('retains indirect injection as transcript data without changing approval', async () => {
    const { service } = createHarness();
    const approved = await prepareApproved(service, 'AMBIGUOUS');
    const fingerprint = approved.approval?.planFingerprint;
    await service.startApprovedSimulation();
    const result = await service.runSimulationToCompletion();

    expect(result.run?.transcript).toContain(INDIRECT_INJECTION_FIXTURE);
    expect(result.approval?.planFingerprint).toBe(fingerprint);
    expect(result.outcome?.securitySignals).toHaveLength(1);
    expect(result.outcome?.commitmentsMade).toEqual([]);
  });

  it('produces deterministic plans and transcripts', async () => {
    const first = createHarness(new MockCallProvider());
    const second = createHarness(new MockCallProvider());
    const firstPlan = await preparePlan(first.service, 'NOMINAL');
    const secondPlan = await preparePlan(second.service, 'NOMINAL');

    expect(firstPlan.plan).toEqual(secondPlan.plan);

    if (firstPlan.plan === null || secondPlan.plan === null) throw new Error('Plan missing.');
    await first.service.recordApproval('APPROVED', firstPlan.plan.transmittedData);
    await second.service.recordApproval('APPROVED', secondPlan.plan.transmittedData);
    await first.service.startApprovedSimulation();
    await second.service.startApprovedSimulation();
    const firstResult = await first.service.runSimulationToCompletion();
    const secondResult = await second.service.runSimulationToCompletion();
    expect(firstResult.run?.transcript).toEqual(secondResult.run?.transcript);
    expect(firstResult.outcome).toEqual(secondResult.outcome);
  });
});
