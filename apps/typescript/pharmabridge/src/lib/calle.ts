// Server-side wrapper around the official @call-e/calle SDK. The API key never leaves the server, goes
// only to an approved CALL-E origin, and is never re-sent on a redirect.
import { CalleAPIError, CalleClient } from "@call-e/calle";
import { redactPhones, regionFromE164 } from "./phone";
import { calleBaseUrl, noRedirectFetch } from "./transport";
import type { CallEventView, CallView, TranscriptTurn } from "./types";

type SdkCall = Awaited<ReturnType<CalleClient["calls"]["get"]>>;
// Webhook payloads carry the raw snake_case API object rather than the SDK's camelCase view.
type RawObject = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const holder = globalThis as unknown as { __pharmabridgeCalle?: CalleClient };

export function calle(): CalleClient {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is not configured.");
  holder.__pharmabridgeCalle ??= new CalleClient({ apiKey, baseUrl: calleBaseUrl(), fetch: noRedirectFetch });
  return holder.__pharmabridgeCalle;
}

function normalizeTurns(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((turn: RawObject) => ({
    offsetSeconds: turn.offset_seconds ?? turn.offsetSeconds ?? null,
    speaker: turn.speaker === "bot" || turn.speaker === "user" ? turn.speaker : "unknown",
    text: String(turn.text ?? ""),
  }));
}

export function toCallView(call: SdkCall): CallView {
  const recipientResult = call.recipients.find((r) => r.structuredResult)?.structuredResult ?? null;
  return {
    id: call.id,
    status: call.status,
    structuredResult: call.structuredResult ?? recipientResult,
    summary: call.summary ?? call.recipients[0]?.summary ?? null,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence,
    evidence: call.evidence ?? [],
    metadata: call.metadata ?? {},
    failureCode: call.failureCode,
    failureMessage: call.failureMessage,
    createdAt: call.createdAt,
    completedAt: call.completedAt,
    attempts: call.recipients.flatMap((recipient) =>
      recipient.attempts.map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        summary: attempt.summary,
        transcriptTurns: normalizeTurns(attempt.transcriptTurns),
        providerCallId: attempt.providerCallId ?? null,
        failureCode: attempt.failureCode,
        failureMessage: attempt.failureMessage,
      })),
    ),
    simulated: false,
  };
}

export function fromRawCallTask(raw: RawObject): CallView {
  const recipients: RawObject[] = Array.isArray(raw.recipients) ? raw.recipients : [];
  return {
    id: String(raw.id),
    status: raw.status,
    structuredResult: raw.structured_result ?? recipients.find((r) => r.structured_result)?.structured_result ?? null,
    summary: raw.summary ?? recipients[0]?.summary ?? null,
    taskCompleted: raw.task_completed ?? null,
    completionConfidence: raw.completion_confidence ?? null,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    metadata: raw.metadata ?? {},
    failureCode: raw.failure_code ?? null,
    failureMessage: raw.failure_message ?? null,
    createdAt: raw.created_at,
    completedAt: raw.completed_at ?? null,
    attempts: recipients.flatMap((recipient) =>
      (Array.isArray(recipient.attempts) ? recipient.attempts : []).map((attempt: RawObject) => ({
        id: String(attempt.id),
        status: attempt.status,
        startedAt: attempt.started_at ?? null,
        completedAt: attempt.completed_at ?? null,
        summary: attempt.summary ?? null,
        transcriptTurns: normalizeTurns(attempt.transcript_turns),
        providerCallId: attempt.provider_call_id ?? null,
        failureCode: attempt.failure_code ?? null,
        failureMessage: attempt.failure_message ?? null,
      })),
    ),
    simulated: false,
  };
}

export interface LiveCallInput {
  task: string;
  phone: string;
  locale?: string;
  resultSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
  webhookUrl?: string;
}

export async function createLiveCall(input: LiveCallInput): Promise<CallView> {
  const region = regionFromE164(input.phone) ?? undefined;
  const request = {
    task: input.task,
    recipients: [{ phones: [input.phone], region, locale: input.locale }],
    resultSchema: input.resultSchema,
    metadata: input.metadata,
    webhookUrl: input.webhookUrl,
  };
  try {
    return toCallView(await calle().calls.create(request, { idempotencyKey: input.idempotencyKey }));
  } catch (error) {
    // The locale is only a hint. If this destination rejects it, retry once without it.
    if (error instanceof CalleAPIError && error.code === "unsupported_language" && input.locale) {
      const retry = { ...request, recipients: [{ phones: [input.phone], region }] };
      return toCallView(await calle().calls.create(retry, { idempotencyKey: `${input.idempotencyKey}:no-locale` }));
    }
    throw error;
  }
}

export async function getLiveCall(callId: string): Promise<CallView> {
  return toCallView(await calle().calls.get(callId));
}

export async function listLiveEvents(callId: string): Promise<CallEventView[]> {
  const page = await calle().calls.listEvents(callId, { limit: 100 });
  return page.data.map((event) => ({
    id: event.id,
    type: event.type,
    level: event.level,
    message: event.message,
    createdAt: event.created_at,
  }));
}

/**
 * True only when CALL-E definitively refused a create request, so no call exists. Timeouts, network
 * errors, redirects, 5xx, and 409 (an identical request still in flight) may have created one.
 */
export function submissionRejected(error: unknown): boolean {
  return error instanceof CalleAPIError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409;
}

export function describeError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof CalleAPIError) {
    return { status: error.status >= 400 ? error.status : 502, code: error.code, message: redactPhones(error.message) };
  }
  if (error instanceof Error) return { status: 502, code: "upstream_error", message: redactPhones(error.message) };
  return { status: 500, code: "internal_error", message: "Unexpected error." };
}
