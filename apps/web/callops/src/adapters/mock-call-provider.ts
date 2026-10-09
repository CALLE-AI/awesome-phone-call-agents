import { ApprovalGateError } from '../domain/errors';
import type { CallPlan, CallRun, MockScenario } from '../domain/models';
import { INDIRECT_INJECTION_FIXTURE } from '../fixtures/demo';
import type {
  CallProvider,
  PlanCallRequest,
  ProviderRunStatus,
  StartCallRequest,
} from '../ports/call-provider';

interface MutableMockRun {
  readonly providerRunId: string;
  readonly scenario: MockScenario;
  state: ProviderRunStatus['state'];
  transcript: readonly string[];
  failureReason: string | null;
  readonly retryScheduled: false;
}

const NOMINAL_TRANSCRIPT = Object.freeze([
  'Mock agent: I am following up on synthetic case DEMO-SAV-2026-0042.',
  'Northstar Repairs Demo service: The replacement has been validated.',
  'Northstar Repairs Demo service: Shipment is expected within 3 to 5 business days.',
  'Northstar Repairs Demo service: No payment is required and no contract change was accepted.',
]);

const AMBIGUOUS_TRANSCRIPT = Object.freeze([
  'Mock agent: I am following up on synthetic case DEMO-SAV-2026-0042.',
  'Northstar Repairs Demo service: The reference is recognized, but no firm delay is available.',
  'Northstar Repairs Demo service: The case should be transferred to the replacement desk.',
  INDIRECT_INJECTION_FIXTURE,
]);

const FAILED_TRANSCRIPT = Object.freeze([
  'Mock system: Northstar Repairs Demo could not be reached in this simulation.',
  'Mock system: No information was obtained and no retry was scheduled.',
]);

function statusCopy(run: MutableMockRun): ProviderRunStatus {
  return {
    providerRunId: run.providerRunId,
    scenario: run.scenario,
    state: run.state,
    transcript: [...run.transcript],
    failureReason: run.failureReason,
    retryScheduled: run.retryScheduled,
  };
}

export class MockCallProvider implements CallProvider {
  public readonly providerType = 'MOCK' as const;
  private readonly runs = new Map<string, MutableMockRun>();

  /** Rehydrate only a validated local simulation; never plan or start again. */
  public constructor(savedRun: CallRun | null = null) {
    if (savedRun === null) return;
    if (savedRun.provider !== 'MOCK' || savedRun.retryScheduled) {
      throw new ApprovalGateError('Only a saved local mock may be resumed.');
    }
    if (!['QUEUED', 'IN_PROGRESS'].includes(savedRun.state)) return;
    if (savedRun.providerRunId !== `mock-run-${savedRun.planId}`
      || !['NOMINAL', 'AMBIGUOUS', 'FAILED'].includes(savedRun.scenario)) {
      throw new ApprovalGateError('Saved mock identity is inconsistent.');
    }
    this.runs.set(savedRun.providerRunId, {
      providerRunId: savedRun.providerRunId,
      scenario: savedRun.scenario,
      state: savedRun.state as 'QUEUED' | 'IN_PROGRESS',
      transcript: savedRun.state === 'QUEUED' ? [] : ['Mock system: Local simulation is in progress.'],
      failureReason: null,
      retryScheduled: false,
    });
  }

  public async planCall(request: PlanCallRequest): Promise<CallPlan> {
    const { supportCase, scenario, now } = request;
    return Promise.resolve({
      id: `plan-${supportCase.id}-${scenario.toLocaleLowerCase()}`,
      caseId: supportCase.id,
      objectiveSummary: supportCase.desiredOutcome,
      proposedScript: [
        'Identify the synthetic case as a local demonstration.',
        `Ask for the replacement status for ${supportCase.syntheticReference}.`,
        'Ask for a factual shipping estimate and whether another service owns the next step.',
        'Refuse payments, contractual changes, reservations, and disclosure requests.',
      ],
      plannedQuestions: [
        'Has the replacement been validated?',
        'What is the current expected shipping delay?',
        'Is a human follow-up or transfer required?',
      ],
      transmittedData: [
        `Organization: ${supportCase.organization}`,
        `Synthetic case reference: ${supportCase.syntheticReference}`,
        'Synthetic product: Demo Laptop Backpack',
        `Requested outcome: ${supportCase.desiredOutcome}`,
        `Authorized information: ${supportCase.authorizedInformation.join(', ')}`,
      ],
      prohibitedBehaviors: [
        'Do not pay or authorize a charge.',
        'Do not accept a contract or policy change.',
        'Do not modify a reservation or delivery address.',
        'Do not disclose forbidden or additional customer data.',
      ],
      stopConditions: [
        'Stop if payment, credentials, personal contact data, or contractual acceptance is requested.',
        'Stop after the factual status and expected delay are obtained.',
      ],
      riskEstimate: 'LOW',
      provider: 'MOCK',
      createdAt: now,
    });
  }

  public async startCall(request: StartCallRequest): Promise<ProviderRunStatus> {
    if (request.plan.provider !== 'MOCK' || request.approval.decision !== 'APPROVED') {
      throw new ApprovalGateError('Mock simulation start was refused by the provider boundary.');
    }
    const providerRunId = `mock-run-${request.plan.id}`;
    const run: MutableMockRun = {
      providerRunId,
      scenario: request.scenario,
      state: 'QUEUED',
      transcript: [],
      failureReason: null,
      retryScheduled: false,
    };
    this.runs.set(providerRunId, run);
    return Promise.resolve(statusCopy(run));
  }

  public async getCallStatus(providerRunId: string): Promise<ProviderRunStatus> {
    const run = this.runs.get(providerRunId);
    if (run === undefined) {
      throw new ApprovalGateError('Unknown mock run.', 'UNKNOWN_MOCK_RUN');
    }
    if (run.state === 'QUEUED') {
      run.state = 'IN_PROGRESS';
      run.transcript = ['Mock system: Local simulation is in progress.'];
    } else if (run.state === 'IN_PROGRESS') {
      if (run.scenario === 'NOMINAL') {
        run.state = 'COMPLETED';
        run.transcript = NOMINAL_TRANSCRIPT;
      } else if (run.scenario === 'AMBIGUOUS') {
        run.state = 'COMPLETED';
        run.transcript = AMBIGUOUS_TRANSCRIPT;
      } else {
        run.state = 'FAILED';
        run.transcript = FAILED_TRANSCRIPT;
        run.failureReason = 'Mock organization unreachable; automatic retry disabled.';
      }
    }
    return Promise.resolve(statusCopy(run));
  }
}
