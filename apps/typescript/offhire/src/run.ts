import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  CalleClient,
  CalleAPIError,
  type Call,
  type CreateCallInput,
} from "@call-e/calle";
import {
  rentalInput,
  type Rental,
  type CallSnapshot,
  type Decision,
} from "./core/types";
import { compileCallPlan } from "./core/call-plan";
import { reconcileCall } from "./core/decision";

export class UserError extends Error {}
export type RunState =
  | "prepared"
  | "dispatching"
  | "dispatch_uncertain"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";
export type Run = {
  version: 1;
  id: string;
  rental: Rental;
  requestJson: string;
  digest: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  state: RunState;
  callId: string | null;
  snapshot: CallSnapshot | null;
  decision: Decision | null;
  error: string | null;
};
export type Settings = {
  apiKey?: string;
  enabled?: boolean;
  authorized?: boolean;
  phone?: string;
  expiresAt?: string;
};
type Transport = (input: Request) => Promise<Response>;
const terminal = (s: string) => ["completed", "failed", "canceled"].includes(s);
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const maskPhone = (phone: string) =>
  phone ? `+••••${phone.slice(-4)}` : "not configured";
const file = (dir: string) => path.join(dir, "run.json");
async function atomicWrite(target: string, value: unknown) {
  const tmp = `${target}.${randomUUID()}.tmp`;
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
}
export async function loadRun(dir: string): Promise<Run> {
  const r = JSON.parse(await readFile(file(dir), "utf8")) as Run;
  if (
    r.version !== 1 ||
    typeof r.requestJson !== "string" ||
    hash(r.requestJson) !== r.digest ||
    r.idempotencyKey !== `offhire-roleplay:${r.id}` ||
    !Number.isFinite(Date.parse(r.expiresAt))
  )
    throw new UserError(
      "The saved request is invalid or changed. Reconcile it before any call.",
    );
  const request = JSON.parse(r.requestJson) as CreateCallInput;
  if (
    !r.rental?.isTest ||
    !rentalInput.safeParse(r.rental).success ||
    request.recipients?.length !== 1 ||
    request.recipients[0].phones?.length !== 1 ||
    request.recipients[0].phones[0] !== r.rental.phone
  )
    throw new UserError(
      "The saved recipient scope does not match the frozen request. Reconcile before calling.",
    );
  return r;
}
export async function withLock<T>(
  dir: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, ".lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new UserError(
      "This run is locked. Another process may be active. See the manual unlock instructions.",
    );
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function unlockRun(dir: string, confirmed: boolean) {
  if (!confirmed)
    throw new UserError(
      "Unlock requires --confirm-process-stopped; never unlock a running process.",
    );
  await stat(file(dir));
  await rm(path.join(dir, ".lock"), { recursive: true, force: true });
}
export async function prepareRun(
  input: unknown,
  dir: string,
  now = new Date(),
): Promise<Run> {
  return withLock(dir, async () => {
    try {
      await stat(file(dir));
      throw new UserError(
        "This directory already contains a run. Inspect, status, or recover it; do not replace it.",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parsed = rentalInput.safeParse(input);
    if (!parsed.success)
      throw new UserError(
        "Invalid rental input. Check required fields, E.164 phone, timezone and request date.",
      );
    if (!parsed.data.isTest)
      throw new UserError(
        "This CLI supports fictional, consenting roleplay calls only.",
      );
    if (
      !parsed.data.phone ||
      !parsed.data.ready ||
      !parsed.data.authorizedContact
    )
      throw new UserError(
        "Provide an owned/authorized E.164 phone and explicitly mark readiness and authorizedContact true.",
      );
    const id = randomUUID();
    const r: Rental = {
      ...parsed.data,
      id: "test-rental-" + id,
      workspaceId: "local-roleplay",
      createdAt: now.toISOString(),
      collectedAt: null,
      writtenConfirmation: false,
      invoiceReviewed: false,
    };
    const request = compileCallPlan(r, id);
    const requestJson = JSON.stringify(request);
    const run: Run = {
      version: 1,
      id,
      rental: r,
      requestJson,
      digest: hash(requestJson),
      idempotencyKey: "offhire-roleplay:" + id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
      approvedAt: null,
      state: "prepared",
      callId: null,
      snapshot: null,
      decision: null,
      error: null,
    };
    await atomicWrite(path.join(dir, "plan.json"), request);
    await atomicWrite(file(dir), run);
    return run;
  });
}
function assertGrant(
  r: Run,
  s: Settings,
  digest: string | undefined,
  now: Date,
) {
  if (digest !== r.digest)
    throw new UserError(
      "Review plan.json, then pass its exact printed digest with --approve.",
    );
  if (!s.enabled || !s.authorized || s.phone !== r.rental.phone)
    throw new UserError(
      "Live calling requires explicit opt-in and authorization for the exact saved destination.",
    );
  if (!s.apiKey) throw new UserError("Configure CALLE_API_KEY privately.");
  const expiry = Date.parse(s.expiresAt || "");
  if (
    !Number.isFinite(expiry) ||
    expiry <= now.getTime() ||
    Date.parse(r.expiresAt) <= now.getTime()
  )
    throw new UserError(
      "Plan or phone authorization expired. Do not create a replacement to bypass an uncertain call; reconcile first.",
    );
}
function client(s: Settings, transport?: Transport) {
  if (!s.apiKey) throw new UserError("Configure CALLE_API_KEY privately.");
  return new CalleClient({
    apiKey: s.apiKey,
    baseUrl: "https://api.heycall-e.com",
    fetch:
      transport ??
      ((request) => fetch(request, { signal: AbortSignal.timeout(25_000) })),
  });
}
export function toSnapshot(c: Call): CallSnapshot {
  return {
    id: c.id,
    status: c.status,
    taskCompleted: c.taskCompleted,
    structuredResult: c.structuredResult,
    summary: c.summary,
    completedAt: c.completedAt,
    failureCode: c.failureCode,
    recipients: c.recipients.map((r) => ({
      status: r.status,
      structuredResult: r.structuredResult,
      attempts: r.attempts.map((a) => ({
        status: a.status,
        transcriptTurns: a.transcriptTurns,
      })),
    })),
  };
}
async function saveCall(dir: string, r: Run, c: Call) {
  if (r.callId && r.callId !== c.id)
    throw new UserError(
      "Provider Call ID mismatch; keep the existing record for review.",
    );
  if (
    !["queued", "in_progress", "completed", "failed", "canceled"].includes(
      c.status,
    )
  )
    throw new UserError(
      "Unknown provider lifecycle. Retain this run for reconciliation.",
    );
  const snapshot = toSnapshot(c);
  const next: Run = {
    ...r,
    callId: c.id,
    state: c.status,
    snapshot,
    decision: terminal(c.status) ? reconcileCall(snapshot, r.rental) : null,
    error: null,
  };
  await atomicWrite(file(dir), next);
  return next;
}
export async function submitRun(
  dir: string,
  s: Settings,
  digest: string | undefined,
  recovery = false,
  transport?: Transport,
  now = new Date(),
): Promise<Run> {
  return withLock(dir, async () => {
    let r = await loadRun(dir);
    if (r.callId || terminal(r.state))
      throw new UserError(
        "This operation already has an outcome or Call ID. Use status; never submit it again.",
      );
    if (
      recovery
        ? !["dispatching", "dispatch_uncertain"].includes(r.state)
        : r.state !== "prepared"
    )
      throw new UserError(
        "An uncertain submission requires the explicit recover command with the original approval digest.",
      );
    assertGrant(r, s, digest, now);
    r = {
      ...r,
      state: "dispatching",
      approvedAt: r.approvedAt ?? now.toISOString(),
      error: null,
    };
    await atomicWrite(file(dir), r);
    let created: Call;
    try {
      created = await client(s, transport).calls.create(
        JSON.parse(r.requestJson) as CreateCallInput,
        { idempotencyKey: r.idempotencyKey },
      );
      if (typeof created.id !== "string" || !created.id.trim())
        throw new Error("Missing provider Call ID");
    } catch (error) {
      const rejected =
        error instanceof CalleAPIError &&
        [400, 401, 403, 404, 422].includes(error.status);
      const next: Run = {
        ...r,
        state: rejected ? "failed" : "dispatch_uncertain",
        error: rejected
          ? "Provider rejected the request. Review configuration before a separately approved operation."
          : "Acceptance is uncertain. Recover this exact request and key; do not create a replacement.",
      };
      await atomicWrite(file(dir), next);
      return next;
    }
    // Save the Call ID before extracting/processing the result; later failures use GET.
    r = { ...r, callId: created.id };
    await atomicWrite(file(dir), r);
    return saveCall(dir, r, created);
  });
}
export async function refreshRun(
  dir: string,
  s: Settings,
  transport?: Transport,
): Promise<Run> {
  return withLock(dir, async () => {
    const r = await loadRun(dir);
    if (terminal(r.state) || !r.callId) return r;
    return saveCall(dir, r, await client(s, transport).calls.get(r.callId));
  });
}
export async function cancelPrepared(dir: string): Promise<Run> {
  return withLock(dir, async () => {
    const r = await loadRun(dir);
    if (r.state !== "prepared")
      throw new UserError(
        "Submitted or uncertain calls cannot be canceled through this API. Closing the CLI does not stop them.",
      );
    const next: Run = { ...r, state: "canceled" };
    await atomicWrite(file(dir), next);
    return next;
  });
}
export function summary(r: Run) {
  return {
    mode: "LIVE ROLEPLAY — not a real rental",
    runId: r.id,
    state: r.state,
    phone: maskPhone(r.rental.phone),
    callId: r.callId,
    billing: r.decision?.billing ?? "unconfirmed",
    pickup: r.decision?.pickup ?? "unknown",
    nextAction:
      r.decision?.nextAction ??
      "Use status to retrieve the same call; never create a replacement.",
    error: r.error,
    privateReceipt: "run.json contains the full local result and transcript.",
  };
}
