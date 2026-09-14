import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { LocalStorageRepository } from '../src/adapters/local-storage-repository';
import { WorkshopMockCallProvider } from '../src/adapters/workshop-mock-call-provider';
import { WorkshopOutcomeExtractor } from '../src/adapters/workshop-outcome-extractor';
import { CallOpsService } from '../src/application/callops-service';
import { WORKSHOP_CASE, WORKSHOP_SCENARIOS } from '../src/fixtures/workshop';
import { DeterministicClock } from './helpers';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number { return this.values.size; }
  public clear(): void { this.values.clear(); }
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  public removeItem(key: string): void { this.values.delete(key); }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('workshop execution and persistence', () => {
  it.each(WORKSHOP_SCENARIOS)('completes $id across restarts with exactly one start', async ({ id }) => {
    const repository = new LocalStorageRepository(new MemoryStorage(), 'workshop');
    const clock = new DeterministicClock();
    const starts: MockInstance[] = [];
    const resume = async () => {
      const saved = await repository.load();
      const provider = new WorkshopMockCallProvider(saved.run);
      starts.push(vi.spyOn(provider, 'startCall'));
      return new CallOpsService(repository, provider, new WorkshopOutcomeExtractor(), clock);
    };
    let service = await resume();
    await service.createSupportCase(WORKSHOP_CASE);
    const planned = await service.createPlan(id);
    await expect(service.startApprovedSimulation()).rejects.toThrow();
    await service.recordApproval('APPROVED', planned.plan?.transmittedData ?? []);
    service = await resume();
    await service.startApprovedSimulation();
    await expect(service.startApprovedSimulation()).rejects.toThrow();
    service = await resume();
    expect((await service.advanceSimulation()).run?.state).toBe('IN_PROGRESS');
    service = await resume();
    const result = await service.advanceSimulation();
    expect(result.run?.state).toBe(id === 'FAILED' ? 'FAILED' : 'COMPLETED');
    expect(result.outcome?.humanDecisionRequired).toBe(id !== 'NOMINAL');
    expect(result.run?.retryScheduled).toBe(false);
    expect(result.outcome?.commitmentsMade).toEqual([]);
    expect(starts.reduce((count, start) => count + start.mock.calls.length, 0)).toBe(1);
    expect(await (await resume()).load()).toEqual(result);
    await expect((await resume()).startApprovedSimulation()).rejects.toThrow();
  });
  it('invalidates approval on a changed question and preserves rejection across reload', async () => {
    const repository = new LocalStorageRepository(new MemoryStorage(), 'workshop');
    const service = new CallOpsService(repository, new WorkshopMockCallProvider(), new WorkshopOutcomeExtractor(), new DeterministicClock());
    await service.createSupportCase(WORKSHOP_CASE);
    const planned = await service.createPlan('AMBIGUOUS');
    await service.recordApproval('APPROVED', planned.plan?.transmittedData ?? []);
    const revised = await service.revisePlan((plan) => ({ ...plan, plannedQuestions: [...plan.plannedQuestions, 'Which date remains uncertain?'] }));
    expect(revised.approval).toBeNull();
    await expect(service.startApprovedSimulation()).rejects.toThrow();
    await service.recordApproval('REJECTED', []);
    const saved = await repository.load();
    const restored = new CallOpsService(repository, new WorkshopMockCallProvider(saved.run), new WorkshopOutcomeExtractor(), new DeterministicClock());
    await expect(restored.startApprovedSimulation()).rejects.toThrow();
    expect((await restored.load()).run?.state).toBe('REJECTED');
  });
  it('isolates workshop storage from the historical demo and unrelated browser entries', async () => {
    const storage = new MemoryStorage();
    storage.setItem('callops.mock.snapshot.v1', 'historical');
    storage.setItem('other-app', 'untouched');
    const repository = new LocalStorageRepository(storage, 'workshop');
    expect((await repository.load()).supportCase).toBeNull();
    await repository.clear();
    expect(storage.getItem('callops.mock.snapshot.v1')).toBe('historical');
    expect(storage.getItem('other-app')).toBe('untouched');
  });
});
