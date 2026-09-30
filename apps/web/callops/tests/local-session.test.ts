import { describe, expect, it, vi } from 'vitest';

import { LocalStorageRepository } from '../src/adapters/local-storage-repository';
import { MockCallProvider } from '../src/adapters/mock-call-provider';
import { RuleBasedOutcomeExtractor } from '../src/adapters/rule-based-outcome-extractor';
import { CallOpsService } from '../src/application/callops-service';
import { EMPTY_SNAPSHOT } from '../src/domain/models';
import type { MockScenario } from '../src/domain/models';
import { DeterministicClock, prepareApproved } from './helpers';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number { return this.values.size; }
  public clear(): void { this.values.clear(); }
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  public removeItem(key: string): void { this.values.delete(key); }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

const KEY = 'callops.mock.snapshot.v1';

describe('local demo persistence', () => {
  it('continues a queued mock after a browser-style service restart', async () => {
    const repository = new LocalStorageRepository(new MemoryStorage());
    const clock = new DeterministicClock();
    const first = new CallOpsService(repository, new MockCallProvider(), new RuleBasedOutcomeExtractor(), clock);
    await prepareApproved(first);
    await first.startApprovedSimulation();
    const saved = await repository.load();
    const restarted = new CallOpsService(repository, new MockCallProvider(saved.run), new RuleBasedOutcomeExtractor(), clock);
    await expect(restarted.advanceSimulation()).resolves.toMatchObject({ run: { state: 'IN_PROGRESS' } });
  });

  it('rejects a structurally invalid stored snapshot with a safe error', async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, '{"supportCase":{}}');
    await expect(new LocalStorageRepository(storage).load()).rejects.toMatchObject({ code: 'INVALID_LOCAL_SNAPSHOT' });
    expect(storage.getItem(KEY)).toBe('{"supportCase":{}}');
  });

  it('validates temporary data before promoting it to the committed key', async () => {
    const storage = new MemoryStorage();
    storage.setItem(`${KEY}.tmp`, 'broken');
    await expect(new LocalStorageRepository(storage).load()).rejects.toMatchObject({ code: 'INVALID_LOCAL_SNAPSHOT' });
    expect(storage.getItem(KEY)).toBeNull();
    expect(storage.getItem(`${KEY}.tmp`)).toBe('broken');
  });

  it('loads and saves an empty snapshot', async () => {
    const repository = new LocalStorageRepository(new MemoryStorage());
    await repository.save(EMPTY_SNAPSHOT);
    expect(await repository.load()).toEqual(EMPTY_SNAPSHOT);
  });

  it.each<MockScenario>(['NOMINAL', 'AMBIGUOUS', 'FAILED'])('resumes %s at each step without starting a second mock', async (scenario) => {
    const repository = new LocalStorageRepository(new MemoryStorage());
    const clock = new DeterministicClock();
    let service = new CallOpsService(repository, new MockCallProvider(), new RuleBasedOutcomeExtractor(), clock);
    await prepareApproved(service, scenario);
    await service.startApprovedSimulation();
    for (let step = 0; step < 2; step += 1) {
      const saved = await repository.load();
      const provider = new MockCallProvider(saved.run);
      const start = vi.spyOn(provider, 'startCall');
      service = new CallOpsService(repository, provider, new RuleBasedOutcomeExtractor(), clock);
      await service.advanceSimulation();
      expect(start).not.toHaveBeenCalled();
    }
    const result = await repository.load();
    expect(result.run?.state).toBe(scenario === 'FAILED' ? 'FAILED' : 'COMPLETED');
    expect(result.audit.filter((event) => event.event === 'MOCK_SIMULATION_QUEUED')).toHaveLength(1);
    expect(result.run?.retryScheduled).toBe(false);
    expect(result.outcome?.humanDecisionRequired).toBe(scenario !== 'NOMINAL');
    expect(JSON.parse(await service.exportSanitizedAudit()) as { mode: string }).toMatchObject({ mode: 'LOCAL_MOCK_ONLY' });
  });

  it('requires new approval after a persisted revision and another reload', async () => {
    const repository = new LocalStorageRepository(new MemoryStorage());
    const service = new CallOpsService(repository, new MockCallProvider(), new RuleBasedOutcomeExtractor(), new DeterministicClock());
    await prepareApproved(service);
    await service.revisePlan((plan) => ({ ...plan, plannedQuestions: [...plan.plannedQuestions, 'Which demo team owns the next step?'] }));
    const restored = await repository.load();
    expect(restored.approval).toBeNull();
    expect(restored.run?.state).toBe('WAITING_FOR_APPROVAL');
    const restarted = new CallOpsService(repository, new MockCallProvider(restored.run), new RuleBasedOutcomeExtractor(), new DeterministicClock());
    await expect(restarted.startApprovedSimulation()).rejects.toMatchObject({ code: 'APPROVAL_GATE_CLOSED' });
  });

  it.each(['provider', 'fingerprint', 'identity', 'outcome', 'extra', 'sensitive'])('refuses a tampered %s without changing storage', async (kind) => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageRepository(storage);
    const service = new CallOpsService(repository, new MockCallProvider(), new RuleBasedOutcomeExtractor(), new DeterministicClock());
    await prepareApproved(service);
    const data = JSON.parse(storage.getItem(KEY) ?? '') as Record<string, Record<string, unknown>>;
    if (kind === 'provider') data.plan!.provider = 'CALLE';
    if (kind === 'fingerprint') data.approval!.planFingerprint = '0'.repeat(64);
    if (kind === 'identity') data.run!.caseId = 'different-demo';
    if (kind === 'outcome') data.outcome = {};
    if (kind === 'extra') data.extra = {};
    if (kind === 'sensitive') data.supportCase!.context = ['demo', 'example.invalid'].join('@');
    const raw = JSON.stringify(data);
    storage.setItem(KEY, raw);
    await expect(repository.load()).rejects.toMatchObject({ code: 'INVALID_LOCAL_SNAPSHOT' });
    expect(storage.getItem(KEY)).toBe(raw);
  });

  it('refuses oversized data and recovers a valid temporary snapshot only', async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, ' '.repeat(131_073));
    await expect(new LocalStorageRepository(storage).load()).rejects.toMatchObject({ code: 'INVALID_LOCAL_SNAPSHOT' });
    storage.removeItem(KEY);
    storage.setItem(`${KEY}.tmp`, JSON.stringify(EMPTY_SNAPSHOT));
    expect(await new LocalStorageRepository(storage).load()).toEqual(EMPTY_SNAPSHOT);
    expect(storage.getItem(`${KEY}.tmp`)).toBeNull();
    expect(storage.getItem(KEY)).toBe(JSON.stringify(EMPTY_SNAPSHOT));
  });

  it('clears only CallOps keys when the user resets the demo', async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, 'broken');
    storage.setItem(`${KEY}.tmp`, 'broken');
    storage.setItem('unrelated-app', 'keep');
    await new LocalStorageRepository(storage).clear();
    expect(storage.length).toBe(1);
    expect(storage.getItem('unrelated-app')).toBe('keep');
  });
});
