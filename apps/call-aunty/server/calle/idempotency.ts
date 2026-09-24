import crypto from "node:crypto";

type IdempotencyRecord = {
  fingerprint: string;
  callId?: string;
  expiresAt: number;
  state: "reserved" | "attached" | "ambiguous";
  manualReviewId?: string;
};

const store = new Map<string, IdempotencyRecord>();
const TTL_MS = 24 * 60 * 60 * 1000;

function gc(now = Date.now()) {
  for (const [key, record] of store) if (record.expiresAt < now) store.delete(key);
}

export function fingerprintPayload(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function fingerprintIdempotencyKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function checkIdempotency(key: string, fingerprint: string) {
  gc();
  const existing = store.get(key);
  if (!existing) return { state: "new" as const };
  if (existing.fingerprint !== fingerprint) return { state: "conflict" as const };
  if (existing.state === "ambiguous") return { state: "ambiguous" as const, manualReviewId: existing.manualReviewId };
  return { state: "duplicate" as const, callId: existing.callId };
}

export function reserveIdempotency(key: string, fingerprint: string) {
  gc();
  store.set(key, { fingerprint, expiresAt: Date.now() + TTL_MS, state: "reserved" });
}

export function attachIdempotencyCallId(key: string, callId: string) {
  const existing = store.get(key);
  if (existing) {
    existing.callId = callId;
    existing.state = "attached";
  }
}

/** Locks an uncertain create key until an operator has reconciled provider state. */
export function markIdempotencyAmbiguous(key: string, fingerprint: string) {
  const manualReviewId = crypto.randomUUID();
  store.set(key, {
    fingerprint,
    expiresAt: Date.now() + TTL_MS,
    state: "ambiguous",
    manualReviewId,
  });
  return manualReviewId;
}

export function resetIdempotencyStore() {
  store.clear();
}
