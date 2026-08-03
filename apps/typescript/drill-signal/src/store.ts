/**
 * Atomic JSON persistence for drill records.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DrillRecord } from "./types.js";
import { redactContacts } from "./state-machine.js";
import { isTerminalDrillStatus } from "./types.js";
import { activeDrillRetentionHours } from "./config.js";

export class StoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface DrillStore {
  get(id: string): DrillRecord | null;
  save(record: DrillRecord): DrillRecord;
  create(record: Omit<DrillRecord, "id" | "createdAt" | "updatedAt">): DrillRecord;
  list(): DrillRecord[];
  purgeStaleActive?(now?: Date): number;
}

export type ClaimResult = "new" | "replay" | "conflict";

export interface LaunchClaimStore {
  tryClaim(drillId: string, idempotencyKey: string): ClaimResult;
  getClaim(drillId: string): string | null;
}

function defaultDataDir(): string {
  return process.env.DRILL_SIGNAL_DATA_DIR ?? join(process.cwd(), ".data");
}

function atomicWrite(path: string, payload: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, payload, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export class JsonDrillStore implements DrillStore {
  private readonly root: string;

  constructor(root = defaultDataDir()) {
    this.root = root;
    mkdirSync(this.root, { recursive: true });
  }

  private pathFor(id: string): string {
    return join(this.root, `${id}.json`);
  }

  get(id: string): DrillRecord | null {
    const record = readJson<DrillRecord>(this.pathFor(id));
    if (record === null) {
      return null;
    }
    return isTerminalDrillStatus(record.status) ? redactContacts(record) : record;
  }

  list(): DrillRecord[] {
    const files = readdirSync(this.root).filter((name) => name.endsWith(".json") && !name.startsWith("launch-claim-"));
    const records: DrillRecord[] = [];
    for (const file of files) {
      const record = readJson<DrillRecord>(join(this.root, file));
      if (record) {
        records.push(isTerminalDrillStatus(record.status) ? redactContacts(record) : record);
      }
    }
    return records;
  }

  save(record: DrillRecord): DrillRecord {
    const toWrite = isTerminalDrillStatus(record.status) ? redactContacts(record) : record;
    atomicWrite(this.pathFor(record.id), JSON.stringify(toWrite, null, 2));
    return toWrite;
  }

  create(record: Omit<DrillRecord, "id" | "createdAt" | "updatedAt">): DrillRecord {
    const now = new Date().toISOString();
    const full: DrillRecord = {
      ...record,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.save(full);
  }

  /** Redact full numbers on active drills older than the configured TTL. */
  purgeStaleActive(now = new Date()): number {
    const cutoffMs = now.getTime() - activeDrillRetentionHours() * 60 * 60 * 1000;
    let purged = 0;
    for (const drill of this.list()) {
      if (isTerminalDrillStatus(drill.status)) {
        continue;
      }
      const updatedMs = Date.parse(drill.updatedAt);
      if (!Number.isFinite(updatedMs) || updatedMs >= cutoffMs) {
        continue;
      }
      const raw = readJson<DrillRecord>(this.pathFor(drill.id));
      if (!raw) {
        continue;
      }
      this.save(redactContacts({ ...raw, status: "cancelled", cancelRequested: true }));
      purged += 1;
    }
    return purged;
  }
}

interface ClaimFile {
  idempotencyKey: string;
  claimedAt: string;
}

/**
 * Process-safe launch claims via atomic file creation (`wx`).
 *
 * Single-instance boundary: claims are durable on local disk. Multiple server
 * instances sharing one data directory are not supported — use one process or
 * external coordination.
 */
export class FileLaunchClaimStore implements LaunchClaimStore {
  private readonly claimsDir: string;

  constructor(root = defaultDataDir()) {
    this.claimsDir = join(root, "claims");
    mkdirSync(this.claimsDir, { recursive: true });
  }

  private claimPath(drillId: string): string {
    return join(this.claimsDir, `${drillId}.json`);
  }

  getClaim(drillId: string): string | null {
    const claim = readJson<ClaimFile>(this.claimPath(drillId));
    return claim?.idempotencyKey ?? null;
  }

  tryClaim(drillId: string, idempotencyKey: string): ClaimResult {
    const path = this.claimPath(drillId);
    const payload: ClaimFile = { idempotencyKey, claimedAt: new Date().toISOString() };
    try {
      writeFileSync(path, JSON.stringify(payload), { encoding: "utf8", flag: "wx", mode: 0o600 });
      return "new";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      const existing = readJson<ClaimFile>(path);
      if (existing?.idempotencyKey === idempotencyKey) {
        return "replay";
      }
      return "conflict";
    }
  }
}

/** @deprecated Use FileLaunchClaimStore */
export class LaunchClaimStore extends FileLaunchClaimStore {}
