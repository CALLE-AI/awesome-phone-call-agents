import { EMPTY_SNAPSHOT, type CallOpsSnapshot } from '../domain/models';
import type { CaseRepository } from '../ports/case-repository';

export class InMemoryRepository implements CaseRepository {
  private snapshot: CallOpsSnapshot = structuredClone(EMPTY_SNAPSHOT);

  public async load(): Promise<CallOpsSnapshot> {
    return Promise.resolve(structuredClone(this.snapshot));
  }

  public async save(snapshot: CallOpsSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    await Promise.resolve();
  }

  public async clear(): Promise<void> {
    this.snapshot = structuredClone(EMPTY_SNAPSHOT);
    await Promise.resolve();
  }
}
