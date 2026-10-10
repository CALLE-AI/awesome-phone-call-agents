import { z } from 'zod';

/**
 * CALL-E's wire vocabulary, transcribed verbatim from the shipped
 * `@call-e/calle@0.7.0` type definitions (dist/generated/schema.d.ts).
 * Nothing here is invented. If CALL-E adds a value, this file changes first.
 */

export const CALLE_CALL_STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'canceled'] as const;
export type CalleCallStatus = (typeof CALLE_CALL_STATUSES)[number];

export const CALLE_ATTEMPT_STATUSES = [
  'queued',
  'dialing',
  'in_progress',
  'completed',
  'failed',
  'canceled',
] as const;
export type CalleAttemptStatus = (typeof CALLE_ATTEMPT_STATUSES)[number];

export const CALLE_RECIPIENT_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const;
export type CalleRecipientStatus = (typeof CALLE_RECIPIENT_STATUSES)[number];

export const TRANSCRIPT_SPEAKERS = ['bot', 'user', 'unknown'] as const;
export type TranscriptSpeaker = (typeof TRANSCRIPT_SPEAKERS)[number];

/** Terminal webhook events. There are exactly three. */
export const CALLE_WEBHOOK_EVENT_TYPES = [
  'call.completed',
  'call.failed',
  'call.result_validation_failed',
] as const;
export type CalleWebhookEventType = (typeof CALLE_WEBHOOK_EVENT_TYPES)[number];

/** Every error code in the OpenAPI `APIError.code` enum. */
export const CALLE_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'rate_limit_exceeded',
  'insufficient_balance',
  'unsupported_region',
  'unsupported_language',
  'recipient_blocked',
  'policy_violation',
  'call_not_ready',
  'no_recipients',
  'invalid_recipient',
  'invalid_phone',
  'result_schema_invalid',
  'recipient_result_schema_invalid',
  'idempotency_conflict',
  'goal_not_published',
  'goal_not_executable',
  'goal_not_ready',
  'schema_override_not_allowed',
  'variables_invalid',
  'provider_unavailable',
  'internal_error',
  'not_found',
] as const;
export type CalleErrorCode = (typeof CALLE_ERROR_CODES)[number];

/**
 * The only codes the docs' recovery guidance says to retry. Everything else is
 * surfaced to the user with its stable code rather than being silently redialled
 * -- retrying `invalid_phone` just burns credit and rings a stranger twice.
 */
export const RETRYABLE_CALLE_ERROR_CODES: readonly CalleErrorCode[] = [
  'rate_limit_exceeded',
  'provider_unavailable',
  'internal_error',
  /*
   * Not in the docs' list, added from what it does in practice: a call refused
   * with this never reached a telephone -- no provider id comes back and
   * nothing is dialled -- so the only cost of trying again is the request
   * itself. Treating it as permanent meant a business was written off as
   * uncontactable because the service was momentarily busy.
   *
   * Safe to retry specifically because Dial sends a stable idempotency key: if
   * the call was in fact created and only the response was lost, the retry
   * returns that same call rather than placing a second one.
   */
  'call_not_ready',
];

/** Plain-language rendering of each failure, for the UI. Section 28 / section 36. */
export const CALLE_ERROR_MESSAGES: Record<string, string> = {
  insufficient_balance: 'Calling credit has run out, so no further calls could be placed.',
  unsupported_region: "Dial cannot place calls to this business's region yet.",
  unsupported_language: 'Dial cannot hold this call in the required language yet.',
  recipient_blocked: 'This business has opted out of receiving automated calls.',
  policy_violation: 'This call was not permitted by the calling provider.',
  invalid_phone: 'The number listed for this business was not a valid phone number.',
  invalid_recipient: 'The number listed for this business could not be dialled.',
  no_recipients: 'No usable phone number was available for this business.',
  rate_limit_exceeded: 'Too many calls at once. Dial will retry shortly.',
  provider_unavailable: 'The calling service is temporarily unavailable.',
  result_schema_invalid: 'Dial could not structure the questions for this call.',
  unauthorized: 'Dial is not configured with valid calling credentials.',
  forbidden: 'The calling account is not permitted to place this call.',
  internal_error: 'The calling service hit an internal error.',
  not_found: 'The call record could not be found.',
  idempotency_conflict: 'A conflicting call was already placed for this step.',
  invalid_request: 'Dial sent something the calling service could not accept.',
  // Nothing was dialled: the service could not start the call at that moment.
  call_not_ready: 'The calling service was not ready to place this call. Dial will try again.',
  recipient_result_schema_invalid: 'Dial could not structure the questions for this call.',
  goal_not_published: 'The calling template this call needs has not been published.',
  goal_not_executable: 'The calling template this call needs cannot be run.',
  goal_not_ready: 'The calling template this call needs is not ready yet.',
  schema_override_not_allowed: 'Dial may not change the questions for this kind of call.',
  variables_invalid: 'Dial could not supply the details this call needed.',
};

export function describeCalleError(code: string | null | undefined, fallback?: string): string {
  if (!code) return fallback ?? 'The call could not be completed.';
  return CALLE_ERROR_MESSAGES[code] ?? fallback ?? 'The call could not be completed.';
}

export const transcriptTurnSchema = z.object({
  offsetSeconds: z.number().nonnegative(),
  speaker: z.enum(TRANSCRIPT_SPEAKERS),
  text: z.string(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const completionConfidenceSchema = z.object({
  score: z.number(),
  label: z.string(),
});
export type CompletionConfidence = z.infer<typeof completionConfidenceSchema>;

/**
 * Webhook envelope. Deliveries are NOT signed -- the SDK's `webhooks.verify()`
 * is marked @deprecated for exactly that reason. So this schema validates
 * structure only, and the receiver treats a valid payload as an untrusted
 * *hint*: it re-fetches the call with our own API key before acting.
 */
export const calleWebhookEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(CALLE_WEBHOOK_EVENT_TYPES),
  created_at: z.string().min(1).max(64),
  data: z
    .object({
      id: z.string().min(1).max(200),
      status: z.enum(CALLE_CALL_STATUSES),
    })
    .passthrough(),
});
export type CalleWebhookEvent = z.infer<typeof calleWebhookEventSchema>;
