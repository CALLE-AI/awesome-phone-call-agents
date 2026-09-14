// Presentation/output only. Never use redacted text to establish evidence.
export const PHONE_REDACTION = "[phone redacted]";
export function redactText(
  value: string,
  secrets: readonly string[] = [],
): string {
  for (const secret of secrets.filter(Boolean)) {
    for (const spelling of new Set([secret, encodeURIComponent(secret)]))
      value = value.split(spelling).join("[credential redacted]");
  }
  value = value.replace(
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi,
    "[credential redacted]",
  );
  value = value.replace(
    /(?:tel:)?%2b(?:\d|%[\da-f]{2}|[()./-]){6,}(?:\d|%3[0-9])/gi,
    PHONE_REDACTION,
  );
  // Process nested JSON rather than damaging its escaping or numeric values.
  if (/^\s*[\[{]/.test(value)) {
    try {
      return JSON.stringify(redactOutput(JSON.parse(value), secrets));
    } catch {
      /* ordinary text */
    }
  }
  // Protect dates, UUIDs and content hashes, which are not telephone numbers.
  return value
    .split(
      /(\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b|\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?\b|\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b|\b[\da-f]{64}\b)/gi,
    )
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /(?<![\p{L}\p{N}])[+＋]?\p{Nd}[\p{Nd}\t ().（）/\u2010-\u2015\u2212-]{5,}\p{Nd}(?:\s*(?:ext\.?|extension|x|#)\s*\p{Nd}{1,6})?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])[（(]\p{Nd}{2,4}[）)][\p{Nd}\t ./\u2010-\u2015\u2212-]{5,}\p{Nd}(?:\s*(?:ext\.?|extension|x|#)\s*\p{Nd}{1,6})?(?![\p{L}\p{N}])/giu,
            (candidate) => {
              const digits = candidate.match(/\p{Nd}/gu) || [];
              // A pair of four-digit research years is not a phone number.
              if (/^(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}$/.test(candidate))
                return candidate;
              return digits.length >= 7 ? PHONE_REDACTION : candidate;
            },
          ),
    )
    .join("");
}

const CALL_STATUSES = new Set([
  "QUEUED",
  "PENDING",
  "CREATED",
  "IN_PROGRESS",
  "DIALING",
  "RINGING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "CANCELLED",
  "PREVIEWED",
  "DEMO_CALL_STARTING",
  "LIVE_CALL_SUBMISSION_REJECTED",
  "LIVE_CALL_SUBMISSION_UNCERTAIN",
  "PROCESSING_EVIDENCE",
  "CHECK_AGAIN",
  "INVALID_RESULT",
  "DECLINED",
  "NO_ANSWER",
  "RESULT_FAILED",
  "CALL_FAILED",
]);
export function publicCallStatus(value: unknown): string {
  const status = String(value || "").toUpperCase();
  return CALL_STATUSES.has(status) ? status : "UNKNOWN";
}

export function redactOutput<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === "string") return redactText(value, secrets) as T;
  if (Array.isArray(value))
    return value.map((item) => redactOutput(item, secrets)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactText(key, secrets),
        /^(?:phone|phone_number|telephone|phones|api_?key|authorization|password)$/i.test(
          key,
        ) &&
        item !== null &&
        item !== ""
          ? /(?:phone|telephone)/i.test(key)
            ? PHONE_REDACTION
            : "[credential redacted]"
          : redactOutput(item, secrets),
      ]),
    ) as T;
  return value;
}

const PROVIDER_ERRORS: Record<string, string> = {
  declined: "The respondent declined the interview.",
  no_answer: "No respondent answered the call.",
  invalid_result: "CALL-E returned evidence that needs manual review.",
  result_failed: "CALL-E did not return a usable structured result.",
  call_failed:
    "CALL-E could not complete the interview. Check the private provider workspace.",
};
export function publicProviderError(
  value: unknown,
): { code: string; message: string } | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      /* historic plain text */
    }
  }
  const candidate =
    value && typeof value === "object" && "code" in value
      ? String(value.code)
      : "";
  const code = Object.hasOwn(PROVIDER_ERRORS, candidate)
    ? candidate
    : "call_failed";
  return { code, message: PROVIDER_ERRORS[code] };
}
