import { createHash, randomUUID } from "node:crypto";
import type { CanonicalCallPayload, MissionEvent } from "./types.js";

function canonicalizeJson(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`NON_JSON_VALUE at ${path}: number must be finite`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`NON_JSON_VALUE at ${path}: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`NON_JSON_VALUE at ${path}: circular reference`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const encoded: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError(`NON_JSON_VALUE at ${path}[${index}]: sparse array`);
        }
        encoded.push(canonicalizeJson(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${encoded.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`NON_JSON_VALUE at ${path}: non-plain object`);
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeJson(obj[key], `${path}.${key}`, ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable JSON encoding for exactly the values that can be sent on the wire. */
export function canonicalize(value: unknown): string {
  return canonicalizeJson(value, "$", new WeakSet());
}

export function payloadSha256(payload: CanonicalCallPayload): string {
  return canonicalSha256(payload);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function providerIdempotencyKey(
  callIntentId: string,
  payload: CanonicalCallPayload,
): string {
  return `${callIntentId}:${payloadSha256(payload)}`;
}

export function assertFrozenPayload(
  callIntentId: string,
  stored: CanonicalCallPayload,
  next: CanonicalCallPayload,
): string {
  const a = payloadSha256(stored);
  const b = payloadSha256(next);
  if (a !== b) {
    const err = new Error(
      `REJECT: call_intent_id ${callIntentId} payload changed (${a.slice(0, 8)}… → ${b.slice(0, 8)}…)`,
    ) as Error & { code: string };
    err.code = "PAYLOAD_CHANGED";
    throw err;
  }
  return providerIdempotencyKey(callIntentId, stored);
}

export type EventHashEnvelope = Omit<MissionEvent, "event_hash">;

/**
 * Hash the complete semantic event envelope. Binding only type/payload would let
 * an attacker rewrite mission ownership, actor, timestamps or provider IDs
 * without invalidating the evidence chain.
 */
export function hashEvent(event: EventHashEnvelope): string {
  const material = canonicalize({
    hash_version: event.hash_version,
    event_id: event.event_id,
    mission_id: event.mission_id,
    sequence_no: event.sequence_no,
    event_type: event.event_type,
    actor: event.actor,
    occurred_at: event.occurred_at,
    call_task_id: event.call_task_id ?? null,
    call_intent_id: event.call_intent_id ?? null,
    provider_run_id: event.provider_run_id ?? null,
    prev_hash: event.prev_hash,
    redacted_payload: event.redacted_payload,
  });
  return createHash("sha256").update(material).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Mask E.164 for logs/evidence — keep country + last 2 digits. */
export function maskE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length < 6) return "+[redacted]";
  return `${digits.slice(0, 3)}******${digits.slice(-2)}`;
}
