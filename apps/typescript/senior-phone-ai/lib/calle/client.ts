import "server-only";
import { resolveBriefingTask } from "../briefings/store";

import { assertCalleCallId, parseCalleCallSnapshot, type CalleCallSnapshot } from "./status";
import { validateOutboundCallRequest, type OutboundCallRequest } from "./outbound";
import { addPostCallSearchInstructions, assertFollowupDestination, CALLE_FOLLOWUP_SCHEMA } from "./followup-evidence";

const CALLE_API_ORIGIN = "https://api.heycall-e.com";

const CALLE_ERROR_CODES = new Set([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "rate_limit_exceeded",
  "insufficient_balance",
  "unsupported_region",
  "unsupported_language",
  "recipient_blocked",
  "policy_violation",
  "call_not_ready",
  "no_recipients",
  "invalid_recipient",
  "invalid_phone",
  "result_schema_invalid",
  "recipient_result_schema_invalid",
  "idempotency_conflict",
  "provider_unavailable",
  "internal_error",
  "not_found",
]);

async function readCalleErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    const code = body.error?.code;
    return typeof code === "string" && CALLE_ERROR_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export class CalleRequestError extends Error {
  constructor(readonly status: number, readonly providerCode?: string) {
    super(`CALL-E create status ${status}`);
    this.name = "CalleRequestError";
  }
}

export function isDefinitiveCalleRejection(cause: unknown): cause is CalleRequestError {
  return cause instanceof CalleRequestError && cause.status >= 400 && cause.status < 500;
}

export async function createCalleCall(
  request: OutboundCallRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CalleCallSnapshot> {
  const validated = validateOutboundCallRequest(request);
  const briefingTask = validated.briefingId ? await resolveBriefingTask(validated.briefingId) : undefined;
  const { calleFollowupsEnabled, createCalleFollowups, calleFollowupsPreview, followupRecipients } = await import("./followup-server");
  const useFollowup = calleFollowupsEnabled() && followupRecipients().includes(validated.destinationE164);
  const followups = useFollowup ? createCalleFollowups() : undefined;
  const task = briefingTask
    ? validated.purpose
      ? `${briefingTask}\nADDITIONAL_OPERATOR_INSTRUCTION=${JSON.stringify(validated.purpose)}`
      : briefingTask
    : validated.purpose
      ? `Identify yourself as Senior Phone AI. ${validated.purpose}`
      : "Identify yourself as Senior Phone AI and have a general conversation with the recipient.";
  const response = await fetcher(`${CALLE_API_ORIGIN}/v1/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": validated.idempotencyKey,
    },
    body: JSON.stringify({
      task: useFollowup ? addPostCallSearchInstructions(task, calleFollowupsPreview()) : task,
      ...(useFollowup ? { result_schema: CALLE_FOLLOWUP_SCHEMA } : {}),
      recipients: [{ phones: [validated.destinationE164] }],
      metadata: { application: "senior-phone-ai" },
    }),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) throw new Error("CALL-E redirect rejected");
  if (!response.ok) throw new CalleRequestError(response.status, await readCalleErrorCode(response));
  const snapshot = parseCalleCallSnapshot(await response.json());
  if (followups) {
    try { await followups.register(snapshot.callId, validated.destinationE164, true); return { ...snapshot, followupRegistration: "armed" }; }
    catch { return { ...snapshot, followupRegistration: "registration_failed" }; }
  }
  return snapshot;
}

export async function getCalleCallSnapshot(
  callId: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  expectedDestination?: string,
): Promise<CalleCallSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(
      `${CALLE_API_ORIGIN}/v1/calls/${encodeURIComponent(assertCalleCallId(callId))}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      },
    );
    if (response.status >= 300 && response.status < 400) {
      throw new Error("CALL-E redirect rejected");
    }
    if (!response.ok) throw new Error(`CALL-E status ${response.status}`);
    const raw = await response.json();
    if (expectedDestination) assertFollowupDestination(raw, expectedDestination);
    const snapshot = parseCalleCallSnapshot(raw);
    if (snapshot.callId !== callId) throw new Error("Call result correlation failed");
    return snapshot;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCalleCallSnapshots(
  callIds: string[],
  apiKey: string,
): Promise<{ calls: CalleCallSnapshot[]; unavailableCount: number }> {
  const results = await Promise.allSettled(callIds.map((callId) => getCalleCallSnapshot(callId, apiKey)));
  const calls = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  calls.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  return { calls, unavailableCount: results.length - calls.length };
}
