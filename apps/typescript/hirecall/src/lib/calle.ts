import { createHash } from "node:crypto";

import { SCREENING_RESULT_SCHEMA } from "@/lib/call-result-schema";

export const DEFAULT_CALLE_BASE_URL = "https://api.heycall-e.com";

export class CalleConfigError extends Error {}

export class CalleApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

export type CalleSnapshot = {
  id: string;
  status: string;
  task?: string | null;
  taskCompleted?: boolean | null;
  task_completed?: boolean | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  completedAt?: string | null;
  structuredResult?: Record<string, unknown> | null;
  recipients?: Array<{
    phones?: string[];
    status?: string;
    structuredResult?: Record<string, unknown> | null;
    attempts?: Array<{
      status?: string;
      startedAt?: string | null;
      completedAt?: string | null;
    }>;
  }>;
};

export type CalleBindExpected = {
  task: string;
  phone: string;
  batchId: string;
  candidateId: string;
};

export function assertTrustedBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CalleConfigError("CALLE_BASE_URL is not a URL. CALLE_API_KEY was not sent.");
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "api.heycall-e.com"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.port !== ""
    || !new Set(["", "/"]).has(url.pathname)
  ) {
    throw new CalleConfigError(
      "CALLE_BASE_URL must be exactly https://api.heycall-e.com. CALLE_API_KEY was not sent.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export const DRY_RUN_CALL_PREFIX = "dry-run:";

export function hasCalleKey() {
  return Boolean(process.env.CALLE_API_KEY?.trim());
}

export function liveCallsEnabled() {
  return process.env.HIRECALL_LIVE_CALLS?.trim().toLowerCase() === "true";
}

export function isDryRunCallId(callId: string) {
  return callId.startsWith(DRY_RUN_CALL_PREFIX);
}

function dryRunStructuredResult(): Record<string, unknown> {
  return {
    identity_confirmed: "yes",
    good_time: "yes",
    education: "Dry-run: no live call was placed.",
    projects: "Dry-run: no live call was placed.",
    work_or_internship: "Dry-run: no live call was placed.",
    off_script: "",
    end_reason: "completed",
    recruiter_follow_up: "Set HIRECALL_LIVE_CALLS=true and CALLE_API_KEY to place a real CALL-E call.",
    callee_quote: "",
  };
}

export function newDryRunCallId(candidateId: string): string {
  return `${DRY_RUN_CALL_PREFIX}${candidateId}:${Date.now()}`;
}

function samePhone(left: string, right: string) {
  const a = left.replace(/\D/g, "");
  const b = right.replace(/\D/g, "");
  return a.length > 0 && a === b;
}

function snapshotTaskCompleted(snapshot: CalleSnapshot) {
  return snapshot.taskCompleted === true || snapshot.task_completed === true;
}

function metaText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function calleIdentityMatches(snapshot: CalleSnapshot, expected: CalleBindExpected) {
  if ((snapshot.task ?? "") !== expected.task) return false;
  const recipients = snapshot.recipients ?? [];
  if (recipients.length !== 1) return false;
  const phones = recipients[0]?.phones ?? [];
  if (phones.length !== 1 || !samePhone(phones[0] ?? "", expected.phone)) return false;
  const metadata = snapshot.metadata ?? {};
  return (
    metaText(metadata, "skill") === "hirecall"
    && metaText(metadata, "batch_id") === expected.batchId
    && metaText(metadata, "candidate_id") === expected.candidateId
  );
}

export function bindCalleSnapshot(snapshot: CalleSnapshot, expected: CalleBindExpected) {
  if (!calleIdentityMatches(snapshot, expected)) return false;
  const recipient = snapshot.recipients?.[0];
  const status = String(snapshot.status ?? "").toLowerCase().replace(/-/g, "_");
  const recipientStatus = String(recipient?.status ?? "").toLowerCase().replace(/-/g, "_");
  return status === "completed" && snapshotTaskCompleted(snapshot) && recipientStatus === "completed";
}

export function dryRunSnapshot(callId: string, expected: CalleBindExpected): CalleSnapshot {
  const now = new Date().toISOString();
  const result = dryRunStructuredResult();
  const id = callId.startsWith(DRY_RUN_CALL_PREFIX) ? callId : newDryRunCallId(expected.candidateId);
  return {
    id,
    status: "completed",
    task: expected.task,
    taskCompleted: true,
    metadata: {
      skill: "hirecall",
      batch_id: expected.batchId,
      candidate_id: expected.candidateId,
    },
    createdAt: now,
    completedAt: now,
    structuredResult: result,
    recipients: [
      {
        phones: [expected.phone],
        status: "completed",
        structuredResult: result,
        attempts: [{ status: "completed", startedAt: now, completedAt: now }],
      },
    ],
  };
}

export function calleConfig() {
  const apiKey = process.env.CALLE_API_KEY?.trim();
  if (!apiKey) {
    throw new CalleConfigError(
      "CALLE_API_KEY is missing. Add it in .env next to package.json and restart npm run dev.",
    );
  }
  const baseUrl = assertTrustedBaseUrl(process.env.CALLE_BASE_URL?.trim() || DEFAULT_CALLE_BASE_URL);
  return { apiKey, baseUrl };
}

async function sdkClient() {
  const { apiKey, baseUrl } = calleConfig();
  const { CalleClient } = await import("@call-e/calle");
  return new CalleClient({ apiKey, baseUrl });
}

function rethrow(error: unknown): never {
  if (error instanceof CalleConfigError || error instanceof CalleApiError) {
    throw error;
  }
  const value = error as { message?: string; status?: number };
  throw new CalleApiError(
    value?.message || "CALL-E did not accept the call.",
    typeof value?.status === "number" ? value.status : null,
  );
}

export function calleRegionForPhone(phone: string): { region: string; locale: string } {
  const digits = phone.replace(/\D/g, "");
  const regions: Array<{ prefix: string; region: string; locale: string }> = [
    { prefix: "971", region: "AE", locale: "en-AE" },
    { prefix: "353", region: "IE", locale: "en-IE" },
    { prefix: "234", region: "NG", locale: "en-NG" },
    { prefix: "254", region: "KE", locale: "en-KE" },
    { prefix: "91", region: "IN", locale: "en-IN" },
    { prefix: "61", region: "AU", locale: "en-AU" },
    { prefix: "44", region: "GB", locale: "en-GB" },
    { prefix: "49", region: "DE", locale: "en-DE" },
    { prefix: "33", region: "FR", locale: "en-FR" },
    { prefix: "81", region: "JP", locale: "en-JP" },
    { prefix: "65", region: "SG", locale: "en-SG" },
    { prefix: "64", region: "NZ", locale: "en-NZ" },
    { prefix: "27", region: "ZA", locale: "en-ZA" },
    { prefix: "1", region: "US", locale: "en-US" },
  ];
  const match = regions.find((row) => digits.startsWith(row.prefix));
  return match ?? { region: "US", locale: "en-US" };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hirecallIdempotencyKey(payload: unknown) {
  return `hirecall-${createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 40)}`;
}

export async function createCalleCall(input: {
  task: string;
  phone: string;
  batchId: string;
  candidateId: string;
  attempt: number;
}): Promise<CalleSnapshot> {
  if (!liveCallsEnabled()) {
    return dryRunSnapshot(newDryRunCallId(input.candidateId), {
      task: input.task,
      phone: input.phone,
      batchId: input.batchId,
      candidateId: input.candidateId,
    });
  }
  try {
    const client = await sdkClient();
    const { region, locale } = calleRegionForPhone(input.phone);
    const body = {
      task: input.task,
      recipients: [{ phones: [input.phone], region, locale }],
      resultSchema: SCREENING_RESULT_SCHEMA as unknown as Record<string, unknown>,
      metadata: {
        skill: "hirecall",
        batch_id: input.batchId,
        candidate_id: input.candidateId,
        attempt: input.attempt,
      },
    };
    const idempotencyKey = hirecallIdempotencyKey(body);
    return (await client.calls.create(body, { idempotencyKey })) as unknown as CalleSnapshot;
  } catch (error) {
    return rethrow(error);
  }
}

export async function getCalleCall(callId: string, expected?: CalleBindExpected): Promise<CalleSnapshot> {
  if (isDryRunCallId(callId)) {
    if (!expected) {
      throw new CalleApiError("Dry-run poll needs the candidate this call was placed for.", 400);
    }
    return dryRunSnapshot(callId, expected);
  }
  try {
    const client = await sdkClient();
    return (await client.calls.get(callId)) as unknown as CalleSnapshot;
  } catch (error) {
    return rethrow(error);
  }
}
