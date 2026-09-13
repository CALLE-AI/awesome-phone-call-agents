import fs from 'node:fs';
import path from 'node:path';

const IDEMPOTENCY_FILE = path.resolve(process.cwd(), 'data', 'idempotency.json');

interface IdempotencyRecord {
  key: string;
  taskId: string;
  providerCallId?: string;
  createdAt: string;
  status: 'PENDING' | 'DISPATCHED' | 'FAILED';
}

function ensureDataDir() {
  const dir = path.dirname(IDEMPOTENCY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadRecords(): Record<string, IdempotencyRecord> {
  ensureDataDir();
  if (!fs.existsSync(IDEMPOTENCY_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(IDEMPOTENCY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveRecords(records: Record<string, IdempotencyRecord>) {
  ensureDataDir();
  fs.writeFileSync(IDEMPOTENCY_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

/**
 * Get or create an idempotency key for a verification task.
 * Guarantees that retrying the same task execution reuses the existing idempotency key.
 */
export function getOrCreateIdempotencyKey(taskId: string): string {
  const records = loadRecords();
  const existing = Object.values(records).find((r) => r.taskId === taskId && r.status !== 'FAILED');
  if (existing) {
    return existing.key;
  }

  const newKey = `trace_task_${taskId}_${Date.now()}`;
  records[newKey] = {
    key: newKey,
    taskId,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
  };
  saveRecords(records);
  return newKey;
}

export function recordCallDispatched(key: string, providerCallId: string) {
  const records = loadRecords();
  if (records[key]) {
    records[key].providerCallId = providerCallId;
    records[key].status = 'DISPATCHED';
    saveRecords(records);
  }
}

export function recordCallFailed(key: string) {
  const records = loadRecords();
  if (records[key]) {
    records[key].status = 'FAILED';
    saveRecords(records);
  }
}
