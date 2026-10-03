import { cloneCalleRunCheckpoint } from '../integrations/calle-run-checkpoint';
import type {
  CalleRunCheckpointRecord,
  CalleRunCheckpointStore,
} from '../integrations/calle-live-types';

export class InMemoryCalleRunCheckpointStore implements CalleRunCheckpointStore {
  private readonly checkpoints = new Map<string, CalleRunCheckpointRecord>();

  public async save(sessionId: string, checkpoint: CalleRunCheckpointRecord): Promise<void> {
    this.checkpoints.set(sessionId, cloneCalleRunCheckpoint(checkpoint));
    await Promise.resolve();
  }

  public async load(sessionId: string): Promise<CalleRunCheckpointRecord | null> {
    const checkpoint = this.checkpoints.get(sessionId);
    return Promise.resolve(checkpoint === undefined ? null : cloneCalleRunCheckpoint(checkpoint));
  }

  public async has(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.checkpoints.has(sessionId));
  }

  public async clear(sessionId: string): Promise<void> {
    this.checkpoints.delete(sessionId);
    await Promise.resolve();
  }
}
