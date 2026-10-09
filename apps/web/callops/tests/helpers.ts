import { InMemoryRepository } from '../src/adapters/in-memory-repository';
import { MockCallProvider } from '../src/adapters/mock-call-provider';
import { RuleBasedOutcomeExtractor } from '../src/adapters/rule-based-outcome-extractor';
import { CallOpsService } from '../src/application/callops-service';
import type { CallOpsSnapshot, MockScenario } from '../src/domain/models';
import { DEMO_SUPPORT_CASE } from '../src/fixtures/demo';
import type { CallProvider } from '../src/ports/call-provider';
import type { Clock } from '../src/ports/clock';

export class DeterministicClock implements Clock {
  private tick = 0;

  public now(): string {
    const value = new Date(Date.UTC(2026, 0, 1, 12, 0, this.tick)).toISOString();
    this.tick += 1;
    return value;
  }
}

export function createHarness(provider: CallProvider = new MockCallProvider()): {
  readonly repository: InMemoryRepository;
  readonly provider: CallProvider;
  readonly clock: DeterministicClock;
  readonly service: CallOpsService;
} {
  const repository = new InMemoryRepository();
  const clock = new DeterministicClock();
  const service = new CallOpsService(
    repository,
    provider,
    new RuleBasedOutcomeExtractor(),
    clock,
  );
  return { repository, provider, clock, service };
}

export async function preparePlan(
  service: CallOpsService,
  scenario: MockScenario = 'NOMINAL',
): Promise<CallOpsSnapshot> {
  await service.createSupportCase(DEMO_SUPPORT_CASE);
  return service.createPlan(scenario);
}

export async function prepareApproved(
  service: CallOpsService,
  scenario: MockScenario = 'NOMINAL',
): Promise<CallOpsSnapshot> {
  const planned = await preparePlan(service, scenario);
  if (planned.plan === null) throw new Error('Test harness did not create a plan.');
  return service.recordApproval('APPROVED', planned.plan.transmittedData);
}

export async function completeScenario(
  service: CallOpsService,
  scenario: MockScenario,
): Promise<CallOpsSnapshot> {
  await prepareApproved(service, scenario);
  await service.startApprovedSimulation();
  return service.runSimulationToCompletion();
}
