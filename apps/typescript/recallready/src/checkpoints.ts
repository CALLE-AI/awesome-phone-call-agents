import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type CallCheckpoint = {
  state: "started" | "completed";
  startedAt: string;
  completedAt?: string;
  callId?: string;
};

export interface CallCheckpointStore {
  claim(idempotencyKey: string): Promise<boolean>;
  complete(idempotencyKey: string, callId: string): Promise<void>;
}
function assertKey(idempotencyKey: string): void {
  if (!/^[a-f0-9]{16,64}$/.test(idempotencyKey)) {
    throw new Error("Call checkpoint key must be a stable hexadecimal fingerprint.");
  }
}

function validCheckpoint(value: unknown): value is CallCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checkpoint = value as Partial<CallCheckpoint>;
  if (checkpoint.state !== "started" && checkpoint.state !== "completed") return false;
  if (typeof checkpoint.startedAt !== "string" || !Number.isFinite(Date.parse(checkpoint.startedAt))) return false;
  if (checkpoint.completedAt !== undefined && (
    typeof checkpoint.completedAt !== "string" || !Number.isFinite(Date.parse(checkpoint.completedAt))
  )) return false;
  if (checkpoint.callId !== undefined && typeof checkpoint.callId !== "string") return false;
  return true;
}

export class MemoryCallCheckpointStore implements CallCheckpointStore {
  readonly checkpoints = new Map<string, CallCheckpoint>();

  async claim(idempotencyKey: string): Promise<boolean> {
    assertKey(idempotencyKey);
    if (this.checkpoints.has(idempotencyKey)) return false;
    this.checkpoints.set(idempotencyKey, { state: "started", startedAt: new Date().toISOString() });
    return true;
  }

  async complete(idempotencyKey: string, callId: string): Promise<void> {
    assertKey(idempotencyKey);
    const checkpoint = this.checkpoints.get(idempotencyKey);
    if (!checkpoint) throw new Error("Call checkpoint was not claimed.");
    this.checkpoints.set(idempotencyKey, {
      ...checkpoint, state: "completed", completedAt: new Date().toISOString(), callId,
    });
  }
}

export class FileCallCheckpointStore implements CallCheckpointStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {
    if (!path) throw new Error("A checkpoint path is required.");
  }

  async claim(idempotencyKey: string): Promise<boolean> {
    assertKey(idempotencyKey);
    return this.serial(async () => {
      const checkpoints = await this.read();
      if (checkpoints[idempotencyKey]) return false;
      checkpoints[idempotencyKey] = { state: "started", startedAt: new Date().toISOString() };
      await this.write(checkpoints);
      return true;
    });
  }

  async complete(idempotencyKey: string, callId: string): Promise<void> {
    assertKey(idempotencyKey);
    await this.serial(async () => {
      const checkpoints = await this.read();
      const checkpoint = checkpoints[idempotencyKey];
      if (!checkpoint) throw new Error("Call checkpoint was not claimed.");
      checkpoints[idempotencyKey] = {
        ...checkpoint, state: "completed", completedAt: new Date().toISOString(), callId,
      };
      await this.write(checkpoints);
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<Record<string, CallCheckpoint>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Call checkpoint file has an invalid shape.");
      }
      for (const [key, checkpoint] of Object.entries(parsed)) {
        assertKey(key);
        if (!validCheckpoint(checkpoint)) throw new Error("Call checkpoint file contains an invalid record.");
      }
      return parsed as Record<string, CallCheckpoint>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(checkpoints: Record<string, CallCheckpoint>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(checkpoints, null, 2)}\n`, {
      encoding: "utf8", mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}
