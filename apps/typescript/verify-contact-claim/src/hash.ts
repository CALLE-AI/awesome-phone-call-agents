/**
 * Canonical JSON and the two hashes built on it.
 *
 * Keys are sorted, so a hash depends on the values rather than on the order a
 * writer happened to use. The idempotency key, the preview receipt and the record
 * chain all come off this one function, so a key that binds content cannot drift
 * from a hash that proves it.
 */

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function digestOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** The first `length` hex characters of a digest, for the places a person retypes. */
export function shortHash(text: string, length: number): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, length);
}
