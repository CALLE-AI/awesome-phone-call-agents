import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export interface IntentDefinition {
  caseId: string;
  trustedContactId: string;
  taskVersion: string;
  schemaVersion: string;
  taskText: string;
  destinationFingerprint: string;
}

export function computeRequestHash(def: IntentDefinition): string {
  return sha256Hex(canonicalize(def));
}

export function idempotencyKeyFor(requestHash: string): string {
  return `cl-${sha256Hex(`changelock:${requestHash}`).slice(0, 32)}`;
}

export function phoneFingerprint(e164: string): string {
  return sha256Hex(`phone:${e164}`);
}

export function changeFingerprint(input: {
  vendorId: string;
  destinationDescriptor: string;
}): string {
  return sha256Hex(canonicalize(input));
}

export function generateSafeCaseCode(): string {
  return `CL-${randomBytes(3).toString("hex").toUpperCase()}`;
}
