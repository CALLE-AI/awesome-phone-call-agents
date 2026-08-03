// ─── Call History (server-side, encrypted in Redis) ──────────────────────────
// Persists terminal call records (completed/failed) per user.
// All values AES-256-GCM encrypted at rest.

import { decryptString, encryptString } from "./crypto";
import { getRedisClient } from "./redis";

const HISTORY_KEY_PREFIX = "calle:history:";
const MAX_HISTORY = 50;
const HISTORY_TTL_SECONDS = 90 * 24 * 3600; // 90 days

export interface StoredCallRecord {
  id: string;
  phone: string;
  goal: string;
  run_id?: string;
  phase: "completed" | "failed";
  createdAt: string; // ISO string
  error?: string;
  outcome?: {
    task_completed: boolean;
    completion_confidence: { score: number; label: string };
    evidence?: string[];
  } | null;
  post_summary?: string | null;
  transcript?: string | null;
  duration_seconds?: number | null;
}

function historyKey(email: string): string {
  return `${HISTORY_KEY_PREFIX}${email}`;
}

export async function saveCallRecord(email: string, record: StoredCallRecord): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  const key = historyKey(email);
  const encrypted = encryptString(JSON.stringify(record));
  await redis.lpush(key, encrypted);
  await redis.ltrim(key, 0, MAX_HISTORY - 1);
  await redis.expire(key, HISTORY_TTL_SECONDS);
}

export async function getCallHistory(email: string): Promise<StoredCallRecord[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  const key = historyKey(email);
  const items = await redis.lrange(key, 0, MAX_HISTORY - 1);
  const records: StoredCallRecord[] = [];
  for (const item of items) {
    try {
      const dec = decryptString(item);
      if (dec) records.push(JSON.parse(dec) as StoredCallRecord);
    } catch {
      // skip corrupt entries
    }
  }
  return records;
}

export async function deleteCallRecord(email: string, callId: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  const key = historyKey(email);
  const items = await redis.lrange(key, 0, MAX_HISTORY - 1);
  for (const item of items) {
    try {
      const dec = decryptString(item);
      if (dec) {
        const rec = JSON.parse(dec) as StoredCallRecord;
        if (rec.id === callId) {
          await redis.lrem(key, 1, item);
          break;
        }
      }
    } catch { /* skip */ }
  }
}

export async function clearCallHistory(email: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  await redis.del(historyKey(email));
}
