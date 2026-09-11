import fs from "node:fs";
import path from "node:path";
import type { QuoteRequest } from "./task.ts";

/**
 * A small JSON ledger for one quote race: the request, one task per vendor and purpose with
 * its stable idempotency key and provider call id, claimed webhook events, and the internal
 * decision. Writes are atomic (temp file + rename), so a crash never leaves half a ledger.
 */
export interface Task {
  id: string;
  vendorId: string;
  kind: "quote" | "hold";
  idempotencyKey: string;
  providerCallId: string | null;
  status: string;
  lastError: string | null;
  result: Record<string, string> | null;
  summary: string;
  transcript: Array<{ speaker: string; text: string }>;
  confidence: string;
  updatedAt: string;
}

export interface Decision {
  vendorId: string;
  approvedAt: string;
  holdApproved: boolean;
}

export interface LedgerData {
  request: QuoteRequest | null;
  tasks: Record<string, Task>;
  events: Record<string, { callId: string; type: string; processedAt: string | null }>;
  decision: Decision | null;
  audit: Array<{ at: string; actor: string; action: string; detail: Record<string, unknown> }>;
}

export const FINAL_STATUSES = ["completed", "failed", "canceled", "result_validation_failed"];
export const taskId = (kind: "quote" | "hold", vendorId: string) => `${kind}:${vendorId}`;

const empty = (): LedgerData => ({ request: null, tasks: {}, events: {}, decision: null, audit: [] });

export class Ledger {
  readonly file: string | null;
  data: LedgerData;

  /** `file` null keeps everything in memory (tests, the demo). */
  constructor(file: string | null) {
    this.file = file;
    this.data = file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as LedgerData) : empty();
  }

  save(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  audit(actor: string, action: string, detail: Record<string, unknown> = {}): void {
    this.data.audit.push({ at: new Date().toISOString(), actor, action, detail });
  }

  /** Creates the task once; later calls return the existing one, key and call id intact. */
  ensureTask(kind: "quote" | "hold", vendorId: string, idempotencyKey: string): Task {
    const id = taskId(kind, vendorId);
    this.data.tasks[id] ??= {
      id, vendorId, kind, idempotencyKey, providerCallId: null, status: "planned", lastError: null,
      result: null, summary: "", transcript: [], confidence: "", updatedAt: new Date().toISOString(),
    };
    return this.data.tasks[id]!;
  }

  updateTask(id: string, patch: Partial<Task>): Task {
    const task = this.data.tasks[id];
    if (!task) throw new Error(`Unknown task ${id}`);
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return task;
  }

  taskByCallId(callId: string): Task | undefined {
    return Object.values(this.data.tasks).find((t) => t.providerCallId === callId);
  }

  openTasks(): Task[] {
    return Object.values(this.data.tasks).filter((t) => t.providerCallId && !FINAL_STATUSES.includes(t.status));
  }

  /** Claims a webhook event before any side effect. False means it was already processed. */
  claimEvent(eventId: string, callId: string, type: string): boolean {
    const seen = this.data.events[eventId];
    if (seen?.processedAt) return false;
    this.data.events[eventId] = { callId, type, processedAt: null };
    this.save();
    return true;
  }

  markEventProcessed(eventId: string): void {
    const event = this.data.events[eventId];
    if (event) event.processedAt = new Date().toISOString();
    this.save();
  }

  /** Releases a claim when processing failed, so CALL-E's retry can succeed. */
  releaseEvent(eventId: string): void {
    delete this.data.events[eventId];
    this.save();
  }
}
