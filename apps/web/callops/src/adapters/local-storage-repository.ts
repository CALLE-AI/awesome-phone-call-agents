import { EMPTY_SNAPSHOT, type CallOpsSnapshot } from '../domain/models';
import { invalidLocalSnapshot, validateMockSnapshot } from '../domain/mock-snapshot';
import type { CaseRepository } from '../ports/case-repository';

async function parseSnapshot(value: string): Promise<CallOpsSnapshot> {
  if (value.length > 131_072) throw invalidLocalSnapshot();
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw invalidLocalSnapshot(); }
  return validateMockSnapshot(parsed);
}

export class LocalStorageRepository implements CaseRepository {
  public constructor(
    private readonly providedStorage?: Storage,
    private readonly namespace: 'mock' | 'workshop' = 'mock',
  ) {}

  private get storage(): Storage { return this.providedStorage ?? window.localStorage; }
  private get storageKey(): string { return `callops.${this.namespace}.snapshot.v1`; }
  private get temporaryKey(): string { return `${this.storageKey}.tmp`; }

  public async load(): Promise<CallOpsSnapshot> {
    const committed = this.storage.getItem(this.storageKey);
    if (committed !== null) return Promise.resolve(parseSnapshot(committed));

    const recoverable = this.storage.getItem(this.temporaryKey);
    if (recoverable !== null) {
      const snapshot = await parseSnapshot(recoverable);
      this.storage.setItem(this.storageKey, recoverable);
      this.storage.removeItem(this.temporaryKey);
      return snapshot;
    }
    return Promise.resolve(structuredClone(EMPTY_SNAPSHOT));
  }

  public async save(snapshot: CallOpsSnapshot): Promise<void> {
    const serialized = JSON.stringify(await validateMockSnapshot(snapshot));
    if (serialized.length > 131_072) throw invalidLocalSnapshot();
    this.storage.setItem(this.temporaryKey, serialized);
    this.storage.setItem(this.storageKey, serialized);
    this.storage.removeItem(this.temporaryKey);
    await Promise.resolve();
  }

  public async clear(): Promise<void> {
    this.storage.removeItem(this.storageKey);
    this.storage.removeItem(this.temporaryKey);
    await Promise.resolve();
  }
}
