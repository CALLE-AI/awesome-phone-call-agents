/**
 * Shared masking for anything derived from a live CALL-E call: provider
 * speech, call summaries, and structured results. Applied both before
 * writing to server logs and before returning provider-derived text to
 * the client, so raw transcripts/phone numbers never leave the process
 * unmasked.
 */

const PHONE_PATTERN = /\+?[0-9][0-9()\-.\s]{6,}[0-9]/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Redacts phone numbers/emails from free text and caps its length.
 * Safe to use on provider transcript text, call summaries, and any
 * other string derived from a live call before it is logged or
 * returned to the client.
 */
export function maskSensitiveText(
    input: unknown,
    maxLength = 240
): string {
    if (typeof input !== "string" || !input) {
        return "";
    }

    let masked = input
        .replace(PHONE_PATTERN, "[redacted-phone]")
        .replace(EMAIL_PATTERN, "[redacted-email]");

    if (masked.length > maxLength) {
        masked = `${masked.slice(0, maxLength)}… [truncated]`;
    }

    return masked;
}

/**
 * Reduces a raw CALL-E call object to a safe subset for server logs.
 * Deliberately drops recipients/transcriptTurns (which contain phone
 * numbers and full provider speech) and masks the summary text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CALL-E SDK call objects are untyped, same as elsewhere in this app.
export function maskCallForLog(call: any) {
    return {
        id: call?.id ?? null,
        status: call?.status ?? null,
        taskCompleted: call?.taskCompleted ?? null,
        completionConfidence: call?.completionConfidence ?? null,
        failureCode:
            call?.failureCode ??
            call?.recipients?.[0]?.attempts?.[0]?.failureCode ??
            null,
        summary: maskSensitiveText(call?.summary),
    };
}

/**
 * Masks the free-text fields of a CALL-E structured result before it is
 * returned to the client. Enum-like fields (yes/no/unknown) pass through
 * unchanged; free-text fields are redacted/truncated.
 */
export function maskStructuredResult(
    result: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
    if (!result || typeof result !== "object") {
        return null;
    }

    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(result)) {
        masked[key] =
            typeof value === "string"
                ? maskSensitiveText(value, 120)
                : value;
    }

    return masked;
}

/**
 * Masks an error before logging it. Only the message is kept; stack
 * traces and provider-returned error payloads can carry raw request/
 * response bodies (including phone numbers), so they are never logged.
 */
export function maskErrorForLog(error: unknown): string {
    if (error instanceof Error) {
        return maskSensitiveText(error.message, 300);
    }

    return "Unknown error";
}
