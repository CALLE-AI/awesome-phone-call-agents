import crypto from "node:crypto";

type IdempotencyRecord = {
  fingerprint: string;
  callId?: string;
  expiresAt: number;
};

const store = new Map<string, IdempotencyRecord>();
const TTL_MS = 24 * 60 * 60 * 1000;

function gc(now = Date.now()) {
  for (const [key, record] of store) {
    if (record.expiresAt < now) store.delete(key);
  }
}

export function fingerprintPayload(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function checkIdempotency(key: string, fingerprint: string) {
  gc();
  const existing = store.get(key);
  if (!existing) return { state: "new" as const };
  if (existing.fingerprint !== fingerprint) return { state: "conflict" as const };
  return { state: "duplicate" as const, callId: existing.callId };
}

export function reserveIdempotency(key: string, fingerprint: string) {
  store.set(key, { fingerprint, expiresAt: Date.now() + TTL_MS });
}

export function attachIdempotencyCallId(key: string, callId: string) {
  const existing = store.get(key);
  if (existing) existing.callId = callId;
}

export function resetIdempotencyStore() {
  store.clear();
}
