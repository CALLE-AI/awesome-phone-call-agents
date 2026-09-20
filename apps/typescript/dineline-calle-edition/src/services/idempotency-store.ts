import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReservationState =
  | "reserved"
  | "dispatching"
  | "completed"
  | "dispatch_unknown";

export interface ReservationRecord {
  idempotencyKey: string;
  contractId: string;
  correlationId: string;
  n8nExecutionId: string | null;
  sourceCallId: string | null;
  toolCallId: string | null;
  state: ReservationState;
  reservedAt: string;
  updatedAt: string;
  completedAt?: string;
  providerCallId?: string | null;
  outcome?: string;
}

export interface ReservationUpdate {
  state: ReservationState;
  updatedAt: string;
  completedAt?: string;
  providerCallId?: string | null;
  outcome?: string;
}

export interface IdempotencyStore {
  reserve(record: ReservationRecord): Promise<boolean>;
  update(idempotencyKey: string, update: ReservationUpdate): Promise<void>;
  read(idempotencyKey: string): Promise<ReservationRecord>;
}

export class FileIdempotencyStore implements IdempotencyStore {
  constructor(readonly directory: string) {}

  async reserve(record: ReservationRecord): Promise<boolean> {
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(this.pathFor(record.idempotencyKey), JSON.stringify(record, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async update(idempotencyKey: string, update: ReservationUpdate): Promise<void> {
    const file = this.pathFor(idempotencyKey);
    const current = await this.read(idempotencyKey);
    await writeFile(file, JSON.stringify({ ...current, ...update }, null, 2), "utf8");
  }

  async read(idempotencyKey: string): Promise<ReservationRecord> {
    return JSON.parse(
      await readFile(this.pathFor(idempotencyKey), "utf8"),
    ) as ReservationRecord;
  }

  private pathFor(idempotencyKey: string): string {
    if (!/^dineline_[a-f0-9]{48}$/.test(idempotencyKey)) {
      throw new Error("Invalid DineLine idempotency key");
    }
    return path.join(this.directory, `${idempotencyKey}.json`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
