import { ApprovalGateError } from '../domain/errors';
import type { CallPlan, CallRun } from '../domain/models';
import { WORKSHOP_TRANSCRIPTS } from '../fixtures/workshop';
import type { CallProvider, PlanCallRequest, ProviderRunStatus, StartCallRequest } from '../ports/call-provider';

/** Local fixtures only. Restoring a run never starts a second simulation. */
export class WorkshopMockCallProvider implements CallProvider {
  public readonly providerType = 'MOCK' as const;
  private readonly runs = new Map<string, ProviderRunStatus>();

  public constructor(savedRun: CallRun | null = null) {
    if (savedRun === null) return;
    if (savedRun.provider !== 'MOCK' || savedRun.retryScheduled
      || !Object.hasOwn(WORKSHOP_TRANSCRIPTS, savedRun.scenario)) throw new ApprovalGateError('Only a workshop simulation can be restored.');
    if (!['QUEUED', 'IN_PROGRESS'].includes(savedRun.state)) return;
    if (savedRun.providerRunId !== `mock-run-${savedRun.planId}`) throw new ApprovalGateError('Saved simulation identity is inconsistent.');
    this.runs.set(savedRun.providerRunId, {
      providerRunId: savedRun.providerRunId, scenario: savedRun.scenario,
      state: savedRun.state as 'QUEUED' | 'IN_PROGRESS', transcript: [...savedRun.transcript],
      failureReason: null, retryScheduled: false,
    });
  }

  public async planCall({ supportCase, scenario, now }: PlanCallRequest): Promise<CallPlan> {
    if (!Object.hasOwn(WORKSHOP_TRANSCRIPTS, scenario)) throw new ApprovalGateError('Unknown workshop scenario.');
    return Promise.resolve({
      id: `plan-${supportCase.id}-${scenario.toLowerCase()}`, caseId: supportCase.id,
      objectiveSummary: supportCase.desiredOutcome,
      proposedScript: ['Introduce the workshop and disclose that this is an automated demo assistant.', 'Ask about each date separately. Preserve estimates and unknowns.', 'Close without making any purchase or customer promise.'],
      plannedQuestions: ['When is the replacement pump expected to arrive?', 'Is the repair complete? If not, is a completion date confirmed?', 'When will the repaired device return? Is that date confirmed or estimated?', 'When can the workshop expect the next supplier update?'],
      transmittedData: [`Workshop: ${supportCase.organization}`, `Repair reference: ${supportCase.syntheticReference}`, 'Equipment: Demo espresso machine', 'Part: Replacement pump'],
      prohibitedBehaviors: ['No payment, purchase, contract or reservation.', 'No address changes or extra customer information.', 'No promise to the customer and no customer message.'],
      stopConditions: ['Stop if payment, credentials or additional personal information are requested.', 'Stop once the available facts and unresolved questions are recorded.'],
      riskEstimate: 'LOW', provider: 'MOCK', createdAt: now,
    });
  }

  public async startCall(request: StartCallRequest): Promise<ProviderRunStatus> {
    if (request.plan.provider !== 'MOCK' || request.approval.decision !== 'APPROVED'
      || !Object.hasOwn(WORKSHOP_TRANSCRIPTS, request.scenario)) throw new ApprovalGateError('Simulation start was refused.');
    const id = `mock-run-${request.plan.id}`;
    if (this.runs.has(id)) throw new ApprovalGateError('This simulation has already started.');
    const status: ProviderRunStatus = { providerRunId: id, scenario: request.scenario, state: 'QUEUED', transcript: [], failureReason: null, retryScheduled: false };
    this.runs.set(id, status);
    return Promise.resolve(structuredClone(status));
  }

  public async getCallStatus(providerRunId: string): Promise<ProviderRunStatus> {
    const previous = this.runs.get(providerRunId);
    if (previous === undefined) throw new ApprovalGateError('Unknown workshop simulation.');
    const status: ProviderRunStatus = previous.state === 'QUEUED'
      ? { ...previous, state: 'IN_PROGRESS', transcript: ['Simulation: Reading the fictional supplier response.'] }
      : previous.state === 'IN_PROGRESS'
        ? { ...previous, state: previous.scenario === 'FAILED' ? 'FAILED' : 'COMPLETED', transcript: [...WORKSHOP_TRANSCRIPTS[previous.scenario]], failureReason: previous.scenario === 'FAILED' ? 'Supplier unreachable in this fictional scenario.' : null }
        : previous;
    this.runs.set(providerRunId, status);
    return Promise.resolve(structuredClone(status));
  }
}
