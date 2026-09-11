import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { withFileLock } from "../storage/file-lock";
import { assertCalleCallId, parseCalleCallIds } from "./status";
import { validateOutboundCallRequest, type OutboundCallRequest } from "./outbound";

type DispatchState = "reserved" | "accepted" | "unknown";

interface RegistryRecord {
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly intentFingerprint: string;
  readonly state: DispatchState;
  readonly callId?: string;
}

interface RegistryFile { readonly version: 1; readonly calls: RegistryRecord[] }

const registryPath = join(process.cwd(), "data", "calle-call-registry.json");
const registryLockPath = `${registryPath}.lock`;
let mutation = Promise.resolve();

async function readRegistry(): Promise<RegistryFile> {
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8")) as RegistryFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.calls)) throw new Error("invalid call registry");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, calls: [] };
    throw error;
  }
}

async function writeRegistry(value: RegistryFile): Promise<void> {
  await mkdir(dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, registryPath);
}

async function mutate<T>(operation: (registry: RegistryFile) => Promise<T>): Promise<T> {
  const previous = mutation;
  let release = () => {};
  mutation = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await withFileLock(registryLockPath, async () => operation(await readRegistry()));
  } finally {
    release();
  }
}

function intentFingerprint(request: OutboundCallRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.destinationE164, request.purpose]))
    .digest("hex");
}

function sameIntent(left: RegistryRecord, right: OutboundCallRequest): boolean {
  return left.intentFingerprint === intentFingerprint(right);
}

export async function reserveOutboundCall(request: OutboundCallRequest): Promise<RegistryRecord> {
  const validated = validateOutboundCallRequest(request);
  return mutate(async (registry) => {
    const existing = registry.calls.find((call) => call.idempotencyKey === validated.idempotencyKey);
    if (existing) {
      if (!sameIntent(existing, validated)) throw new Error("idempotency key was reused with changed details");
      return existing;
    }
    if (registry.calls.some((call) => call.state === "unknown" && sameIntent(call, validated))) {
      throw new Error("a matching call has an unresolved dispatch");
    }
    const record: RegistryRecord = {
      createdAt: new Date().toISOString(),
      idempotencyKey: validated.idempotencyKey,
      intentFingerprint: intentFingerprint(validated),
      state: "reserved",
    };
    await writeRegistry({ version: 1, calls: [record, ...registry.calls].slice(0, 100) });
    return record;
  });
}

export async function recordOutboundCallResult(
  idempotencyKey: string,
  result: { state: "accepted"; callId: string } | { state: "unknown" },
): Promise<void> {
  await mutate(async (registry) => {
    const calls = registry.calls.map((call): RegistryRecord => call.idempotencyKey === idempotencyKey
      ? { ...call, state: result.state, callId: result.state === "accepted" ? assertCalleCallId(result.callId) : undefined }
      : call);
    await writeRegistry({ version: 1, calls });
  });
}

export async function listRegisteredCallIds(environmentValue?: string): Promise<string[]> {
  const configured = parseCalleCallIds(environmentValue);
  const registry = await readRegistry();
  const recorded = registry.calls.flatMap((call) => call.state === "accepted" && call.callId ? [assertCalleCallId(call.callId)] : []);
  return [...new Set([...recorded, ...configured])].slice(0, 20);
}
