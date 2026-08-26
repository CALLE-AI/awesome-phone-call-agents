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
  createdAt?: string | null;
  completedAt?: string | null;
  structuredResult?: Record<string, unknown> | null;
  recipients?: Array<{
    status?: string;
    structuredResult?: Record<string, unknown> | null;
    attempts?: Array<{
      status?: string;
      startedAt?: string | null;
      completedAt?: string | null;
    }>;
  }>;
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

export function dryRunSnapshot(callId: string): CalleSnapshot {
  const now = new Date().toISOString();
  const result = dryRunStructuredResult();
  return {
    id: callId.startsWith(DRY_RUN_CALL_PREFIX) ? callId : newDryRunCallId(callId),
    status: "completed",
    createdAt: now,
    completedAt: now,
    structuredResult: result,
    recipients: [
      {
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

export async function createCalleCall(input: {
  task: string;
  phone: string;
  batchId: string;
  candidateId: string;
  idempotencyKey: string;
}): Promise<CalleSnapshot> {
  if (!liveCallsEnabled()) {
    return dryRunSnapshot(newDryRunCallId(input.candidateId));
  }
  try {
    const client = await sdkClient();
    const { region, locale } = calleRegionForPhone(input.phone);
    return (await client.calls.create(
      {
        task: input.task,
        recipients: [{ phones: [input.phone], region, locale }],
        resultSchema: SCREENING_RESULT_SCHEMA as unknown as Record<string, unknown>,
        metadata: {
          skill: "hirecall",
          batch_id: input.batchId,
          candidate_id: input.candidateId,
        },
      },
      { idempotencyKey: input.idempotencyKey },
    )) as unknown as CalleSnapshot;
  } catch (error) {
    return rethrow(error);
  }
}

export async function getCalleCall(callId: string): Promise<CalleSnapshot> {
  if (isDryRunCallId(callId)) {
    return dryRunSnapshot(callId);
  }
  try {
    const client = await sdkClient();
    return (await client.calls.get(callId)) as unknown as CalleSnapshot;
  } catch (error) {
    return rethrow(error);
  }
}
