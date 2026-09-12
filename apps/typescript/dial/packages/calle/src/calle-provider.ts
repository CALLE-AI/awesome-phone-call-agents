import { CalleClient } from '@call-e/calle';
import {
  CALLE_CALL_STATUSES,
  CALLE_ATTEMPT_STATUSES,
  TRANSCRIPT_SPEAKERS,
  RETRYABLE_CALLE_ERROR_CODES,
  type CalleCallStatus,
  type CalleAttemptStatus,
  type TranscriptTurn,
} from '@dial/schemas';
import { maskPhone } from '@dial/domain';
import { logger } from '@dial/observability';
import {
  ProviderError,
  type CallProvider,
  type ProviderCallRequest,
  type ProviderCallSnapshot,
  type ProviderAttempt,
} from './provider.js';

/**
 * The real integration, built against the shipped `@call-e/calle@0.7.0` type
 * definitions (verified in dist/calls.d.ts, not inferred from prose docs).
 *
 * Deliberately NOT used:
 *  - `createAndWait` / `waitForResult`: they hold a thread for up to two
 *    minutes. Dial creates the call, returns immediately, and reconciles via the
 *    worker's poller plus the terminal webhook. Phone work must never depend on
 *    an HTTP request staying open (section 5).
 *  - any cancellation call: the Calls API exposes none. Dial therefore never
 *    renders a "cancel this call" button it cannot honour; the guard sits before
 *    dispatch instead, in the authorization gate.
 *
 * The API key is read from server config only and never leaves this process.
 */
export class CalleCallProvider implements CallProvider {
  readonly name = 'calle' as const;
  readonly placesRealCalls = true;

  private readonly client: CalleClient;

  constructor(apiKey: string, baseUrl: string) {
    if (!apiKey) {
      throw new Error('CalleCallProvider requires a CALL-E API key.');
    }
    this.client = new CalleClient({ apiKey, baseUrl });
  }

  async create(request: ProviderCallRequest): Promise<ProviderCallSnapshot> {
    try {
      const call = await this.client.calls.create(
        {
          task: request.task,
          // An explicit recipient beats letting CALL-E infer a number from the
          // task text: we have already validated this exact number, and it keeps
          // the raw number out of the stored brief.
          recipients: [
            {
              phones: [request.phone],
              ...(request.locale ? { locale: request.locale } : {}),
            },
          ],
          resultSchema: request.resultSchema as unknown as Record<string, unknown>,
          metadata: request.metadata,
          ...(request.webhookUrl ? { webhookUrl: request.webhookUrl } : {}),
        },
        { idempotencyKey: request.idempotencyKey },
      );
      logger.info('calle call created', {
        providerRequestId: call.id,
        status: call.status,
        phone: request.phone,
      });
      return normalizeCall(call);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async get(providerCallId: string): Promise<ProviderCallSnapshot> {
    try {
      return normalizeCall(await this.client.calls.get(providerCallId));
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

/** SDK `Call` -> our snapshot, with phone numbers masked on the way in. */
export function normalizeCall(call: Record<string, any>): ProviderCallSnapshot {
  const attempts: ProviderAttempt[] = [];

  for (const recipient of call['recipients'] ?? []) {
    for (const attempt of recipient.attempts ?? []) {
      attempts.push({
        id: String(attempt.id ?? ''),
        // The raw number already lives on the call row; attempt payloads end up
        // in API responses, so they carry only the masked form.
        phoneMasked: maskPhone(attempt.phone ?? recipient.phones?.[0] ?? null),
        status: coerce<CalleAttemptStatus>(attempt.status, CALLE_ATTEMPT_STATUSES, 'queued'),
        startedAt: attempt.startedAt ?? attempt.started_at ?? null,
        completedAt: attempt.completedAt ?? attempt.completed_at ?? null,
        summary: attempt.summary ?? null,
        transcript: normalizeTranscript(attempt.transcriptTurns ?? attempt.transcript_turns ?? []),
        failureCode: attempt.failureCode ?? attempt.failure_code ?? null,
        failureMessage: attempt.failureMessage ?? attempt.failure_message ?? null,
      });
    }
  }

  const confidence = call['completionConfidence'] ?? call['completion_confidence'] ?? null;

  return {
    providerCallId: String(call['id']),
    status: coerce<CalleCallStatus>(call['status'], CALLE_CALL_STATUSES, 'queued'),
    // null here is CALL-E telling us it could not produce a schema-valid result.
    // It is propagated as null, never softened into {}.
    structuredResult:
      (call['structuredResult'] ?? call['structured_result'] ?? null) as Record<string, unknown> | null,
    summary: call['summary'] ?? null,
    taskCompleted: call['taskCompleted'] ?? call['task_completed'] ?? null,
    completionConfidence: confidence
      ? { score: Number(confidence.score ?? 0), label: String(confidence.label ?? 'unknown') }
      : null,
    evidence: Array.isArray(call['evidence']) ? call['evidence'].map(String) : [],
    attempts,
    failureCode: call['failureCode'] ?? call['failure_code'] ?? null,
    failureMessage: call['failureMessage'] ?? call['failure_message'] ?? null,
    createdAt: call['createdAt'] ?? call['created_at'] ?? new Date().toISOString(),
    completedAt: call['completedAt'] ?? call['completed_at'] ?? null,
  };
}

function normalizeTranscript(turns: any[]): TranscriptTurn[] {
  return turns.map((turn) => ({
    offsetSeconds: Number(turn.offsetSeconds ?? turn.offset_seconds ?? 0),
    speaker: coerce(turn.speaker, TRANSCRIPT_SPEAKERS, 'unknown'),
    text: String(turn.text ?? ''),
  }));
}

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;
}

/**
 * Maps SDK/API errors onto our provider error while preserving CALL-E's stable
 * codes. Only the codes CALL-E's own recovery guidance calls retryable are
 * marked as such: redialling after `invalid_phone` just rings a stranger twice.
 */
export function toProviderError(error: unknown): ProviderError {
  const e = error as { code?: string; status?: number; message?: string; name?: string };
  const code = e?.code ?? 'provider_unavailable';
  const status = typeof e?.status === 'number' ? e.status : 502;
  const message = e?.message ?? 'The calling provider rejected the request.';

  const retryable =
    (RETRYABLE_CALLE_ERROR_CODES as readonly string[]).includes(code) ||
    e?.name === 'CalleConnectionError' ||
    e?.name === 'CalleTimeoutError';

  return new ProviderError(code, message, status, retryable);
}
