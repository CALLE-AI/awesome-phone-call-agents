import type { CallOpsSnapshot } from '../domain/models';

export interface CaseRepository {
  load(): Promise<CallOpsSnapshot>;
  save(snapshot: CallOpsSnapshot): Promise<void>;
  clear(): Promise<void>;
}
