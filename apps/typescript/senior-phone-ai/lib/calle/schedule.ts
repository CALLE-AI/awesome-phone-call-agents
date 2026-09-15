import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { withFileLock } from "../storage/file-lock";
import { callFailureCode, writeCallLog } from "../observability/call-log";
import { createCalleCall, isDefinitiveCalleRejection } from "./client";
import { type OutboundCallRequest, outboundCallPreview, validateOutboundCallRequest } from "./outbound";
import { recordOutboundCallResult, reserveOutboundCall } from "./registry";
import { scheduledCallDispatchDecision, type ScheduledCallStatus, type ScheduledCallSummary, validateScheduledFor } from "./schedule-types";

interface SealedValue { readonly iv: string; readonly ciphertext: string; readonly tag: string }
interface ScheduledCallRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly scheduledFor: string;
  readonly destinationSummary: string;
  readonly sealedRequest: SealedValue;
  readonly status: ScheduledCallStatus;
  readonly callId?: string;
}
interface ScheduleFile { readonly version: 1; readonly calls: ScheduledCallRecord[] }

const schedulePath = join(process.cwd(), "data", "calle-call-schedule.json");
const scheduleLockPath = `${schedulePath}.lock`;
let mutation = Promise.resolve();

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update("senior-phone-ai:scheduled-call:v1\0").update(secret).digest();
}

function seal(request: OutboundCallRequest, secret: string): SealedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(request), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function open(value: SealedValue, secret: string): OutboundCallRequest {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return validateOutboundCallRequest(JSON.parse(plaintext) as OutboundCallRequest);
}

async function readSchedule(): Promise<ScheduleFile> {
  try {
    const parsed = JSON.parse(await readFile(schedulePath, "utf8")) as ScheduleFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.calls)) throw new Error("invalid scheduled-call registry");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, calls: [] };
    throw error;
  }
}

async function writeSchedule(value: ScheduleFile): Promise<void> {
  await mkdir(dirname(schedulePath), { recursive: true });
  const temporaryPath = `${schedulePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, schedulePath);
}

async function mutate<T>(operation: (schedule: ScheduleFile) => Promise<T>): Promise<T> {
  const previous = mutation;
  let release = () => {};
  mutation = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await withFileLock(scheduleLockPath, async () => operation(await readSchedule()));
  } finally {
    release();
  }
}

function summary(record: ScheduledCallRecord, secret: string): ScheduledCallSummary {
  const request = open(record.sealedRequest, secret);
  return {
    id: record.id,
    createdAt: record.createdAt,
    scheduledFor: record.scheduledFor,
    destinationSummary: record.destinationSummary,
    purpose: request.purpose || "No specific purpose",
    status: record.status,
    callReference: record.callId ? `${record.callId.slice(0, 14)}…` : undefined,
  };
}

export async function createScheduledCall(request: OutboundCallRequest, scheduledFor: string, secret: string): Promise<ScheduledCallSummary> {
  const validated = validateOutboundCallRequest(request);
  const instant = validateScheduledFor(scheduledFor);
  return mutate(async (schedule) => {
    const existing = schedule.calls.find((call) => call.id === validated.idempotencyKey);
    if (existing) return summary(existing, secret);
    const record: ScheduledCallRecord = {
      id: validated.idempotencyKey,
      createdAt: new Date().toISOString(),
      scheduledFor: instant,
      destinationSummary: outboundCallPreview(validated).destinationSummary,
      sealedRequest: seal(validated, secret),
      status: "pending",
    };
    await writeSchedule({ version: 1, calls: [record, ...schedule.calls].slice(0, 100) });
    await writeCallLog({
      destinationE164: validated.destinationE164,
      event: "schedule_created",
      requestId: record.id,
      scheduledFor: record.scheduledFor,
    });
    return summary(record, secret);
  });
}

export async function listScheduledCalls(secret: string): Promise<ScheduledCallSummary[]> {
  const schedule = await readSchedule();
  return schedule.calls.map((call) => summary(call, secret));
}

export async function cancelScheduledCall(id: string, secret: string): Promise<ScheduledCallSummary> {
  return mutate(async (schedule) => {
    const existing = schedule.calls.find((call) => call.id === id);
    if (!existing) throw new Error("scheduled call does not exist");
    if (existing.status !== "pending" && existing.status !== "canceled") throw new Error("scheduled call has already started");
    const updated = existing.status === "canceled" ? existing : { ...existing, status: "canceled" as const };
    await writeSchedule({ version: 1, calls: schedule.calls.map((call) => call.id === id ? updated : call) });
    if (existing.status !== "canceled") {
      await writeCallLog({ event: "schedule_canceled", requestId: id, scheduledFor: existing.scheduledFor });
    }
    return summary(updated, secret);
  });
}

async function claimDueCall(now: Date): Promise<{ record?: ScheduledCallRecord; expired: boolean } | undefined> {
  return mutate(async (schedule) => {
    // UI refreshes also run this scheduler. Do not let a later poll bypass an
    // ambiguous dispatch; the operator must reconcile its existing intent first.
    if (schedule.calls.some((call) => call.status === "unknown")) return undefined;
    const due = schedule.calls
      .filter((call) => call.status === "pending" && scheduledCallDispatchDecision(call.scheduledFor, now) !== "not_due")
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];
    if (!due) return undefined;
    if (scheduledCallDispatchDecision(due.scheduledFor, now) === "expired") {
      const expired = { ...due, status: "expired" as const };
      await writeSchedule({ version: 1, calls: schedule.calls.map((call) => call.id === due.id ? expired : call) });
      await writeCallLog({ event: "schedule_expired", requestId: due.id, scheduledFor: due.scheduledFor });
      return { expired: true };
    }
    const claimed = { ...due, status: "claimed" as const };
    await writeSchedule({ version: 1, calls: schedule.calls.map((call) => call.id === due.id ? claimed : call) });
    await writeCallLog({ event: "dispatch_claimed", requestId: due.id, scheduledFor: due.scheduledFor });
    return { record: claimed, expired: false };
  });
}

async function finishClaim(id: string, result: { status: "accepted"; callId: string } | { status: "rejected" | "unknown" }): Promise<void> {
  await mutate(async (schedule) => {
    await writeSchedule({
      version: 1,
      calls: schedule.calls.map((call): ScheduledCallRecord => call.id === id
        ? { ...call, status: result.status, callId: result.status === "accepted" ? result.callId : undefined }
        : call),
    });
  });
}

export async function runDueScheduledCalls(secret: string, now = new Date()): Promise<{ processed: number; expired: number }> {
  let processed = 0;
  let expired = 0;
  for (;;) {
    const claimed = await claimDueCall(now);
    if (!claimed) return { processed, expired };
    if (claimed.expired) {
      expired += 1;
      continue;
    }
    if (!claimed.record) throw new Error("scheduled call claim is invalid");
    const request = open(claimed.record.sealedRequest, secret);
    const startedAt = Date.now();
    try {
      const reservation = await reserveOutboundCall(request);
      if (reservation.state === "accepted" && reservation.callId) {
        await finishClaim(claimed.record.id, { status: "accepted", callId: reservation.callId });
        await writeCallLog({
          destinationE164: request.destinationE164,
          durationMs: Date.now() - startedAt,
          event: "provider_accepted",
          requestId: claimed.record.id,
          source: "registry",
        });
      } else if (reservation.state === "unknown") {
        await finishClaim(claimed.record.id, { status: "unknown" });
        await writeCallLog({
          destinationE164: request.destinationE164,
          durationMs: Date.now() - startedAt,
          event: "provider_outcome_unknown",
          requestId: claimed.record.id,
          source: "registry",
        });
        return { processed: processed + 1, expired };
      } else {
        await writeCallLog({
          destinationE164: request.destinationE164,
          event: "provider_request_started",
          requestId: claimed.record.id,
          source: "provider",
        });
        const result = await createCalleCall(request, secret);
        await recordOutboundCallResult(request.idempotencyKey, { state: "accepted", callId: result.callId });
        await finishClaim(claimed.record.id, { status: "accepted", callId: result.callId });
        await writeCallLog({
          destinationE164: request.destinationE164,
          durationMs: Date.now() - startedAt,
          event: "provider_accepted",
          requestId: claimed.record.id,
          source: "provider",
        });
      }
    } catch (cause) {
      const rejected = isDefinitiveCalleRejection(cause);
      await recordOutboundCallResult(request.idempotencyKey, {
        state: rejected ? "rejected" : "unknown",
      }).catch(() => undefined);
      await finishClaim(claimed.record.id, { status: rejected ? "rejected" : "unknown" });
      await writeCallLog({
        destinationE164: request.destinationE164,
        durationMs: Date.now() - startedAt,
        event: rejected ? "provider_rejected" : "provider_request_failed",
        providerCode: callFailureCode(cause),
        requestId: claimed.record.id,
        source: "provider",
      });
      if (!rejected) return { processed: processed + 1, expired };
    }
    processed += 1;
  }
}
