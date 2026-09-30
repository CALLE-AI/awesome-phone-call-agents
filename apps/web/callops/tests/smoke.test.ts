import { describe, expect, it } from 'vitest';

import { createHarness } from './helpers';
import { DEMO_SUPPORT_CASE } from '../src/fixtures/demo';

describe('local vertical-slice smoke test', () => {
  it('runs case → plan → approval → mock states → outcome end to end', async () => {
    const { service } = createHarness();
    const created = await service.createSupportCase(DEMO_SUPPORT_CASE);
    expect(created.supportCase?.status).toBe('DRAFT');

    const planned = await service.createPlan('NOMINAL');
    expect(planned.run?.state).toBe('WAITING_FOR_APPROVAL');
    if (planned.plan === null) throw new Error('Smoke plan missing.');

    const approved = await service.recordApproval('APPROVED', planned.plan.transmittedData);
    expect(approved.run?.state).toBe('APPROVED');

    const queued = await service.startApprovedSimulation();
    expect(queued.run?.state).toBe('QUEUED');

    const inProgress = await service.advanceSimulation();
    expect(inProgress.run?.state).toBe('IN_PROGRESS');

    const completed = await service.advanceSimulation();
    expect(completed.run?.state).toBe('COMPLETED');
    expect(completed.outcome?.confirmedFacts.length).toBeGreaterThan(0);
    expect(completed.outcome?.commitmentsMade).toEqual([]);
    expect(completed.audit).toHaveLength(6);
  });
});
