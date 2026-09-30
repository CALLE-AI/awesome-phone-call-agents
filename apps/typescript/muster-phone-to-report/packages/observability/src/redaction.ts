const SAFE_EVENT_KEYS = new Set([
  "event",
  "correlationId",
  "jobType",
  "outcome",
  "dependency",
  "duration",
  "route",
  "method",
  "statusCode",
  "traceId",
  "spanId",
  "providerResponseStatusCode",
  "providerResponseContentType",
  "providerResponseBody",
  "providerResponseLocation",
  "providerRequestIdPresent",
]);
const SAFE_BINDING_KEYS = new Set([
  "service",
  "environment",
  "version",
  "runtime",
  "correlationId",
]);
const SAFE_REASON_VALUES = new Set([
  "evidence_timestamp_invalid",
  "application_persistence_failed",
  "provider_timeout",
  "provider_failed",
  "provider_authentication",
  "provider_rate_limited",
  "provider_insufficient_balance",
  "provider_recipient_blocked",
  "provider_invalid_recipient",
  "provider_unsupported_region",
  "provider_policy_violation",
  "provider_create_response_invalid",
  "provider_unavailable",
  "provider_no_answer",
  "provider_busy",
  "provider_evidence_invalid",
  "provider_evidence_invalid_terminal_shape",
  "provider_evidence_invalid_reading_shape",
  "provider_evidence_invalid_zone_identity",
  "provider_evidence_invalid_anchor_value",
  "provider_evidence_invalid_anchor_unit",
  "provider_evidence_invalid_anchor_status",
  "provider_evidence_invalid_auxiliary_status",
  "provider_evidence_unavailable",
]);
const REDACTED = "[REDACTED]";
const PROTECTED_WORD =
  /(?:^|[^a-z])(authorization|bearer|password|secret|token|transcript)(?:$|[^a-z])/iu;
const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+@/iu;
const SAFE_PROVIDER_RESPONSE_CONTENT_TYPES = new Set(["missing", "json", "text", "other"]);
const SAFE_PROVIDER_RESPONSE_BODIES = new Set(["absent", "present", "unavailable"]);
const SAFE_PROVIDER_RESPONSE_LOCATIONS = new Set([
  "missing",
  "invalid",
  "cross_origin",
  "invalid_call_resource",
  "exact_call_resource",
]);

function protectedString(value: string): boolean {
  const digitCount = [...value].filter((character) => /\d/u.test(character)).length;
  const phoneLike = digitCount >= 10 && /^[+\d\s().-]+$/u.test(value);
  return phoneLike || PROTECTED_WORD.test(value) || CREDENTIAL_URL.test(value);
}

function sanitizePrimitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return protectedString(value) ? REDACTED : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

export function sanitizeLogEvent(event: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "reason") {
      if (typeof value === "string" && SAFE_REASON_VALUES.has(value)) sanitized[key] = value;
      continue;
    }
    if (key === "providerResponseStatusCode") {
      if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
        sanitized[key] = value;
      }
      continue;
    }
    if (key === "providerResponseContentType") {
      if (typeof value === "string" && SAFE_PROVIDER_RESPONSE_CONTENT_TYPES.has(value)) {
        sanitized[key] = value;
      }
      continue;
    }
    if (key === "providerResponseBody") {
      if (typeof value === "string" && SAFE_PROVIDER_RESPONSE_BODIES.has(value)) {
        sanitized[key] = value;
      }
      continue;
    }
    if (key === "providerResponseLocation") {
      if (typeof value === "string" && SAFE_PROVIDER_RESPONSE_LOCATIONS.has(value)) {
        sanitized[key] = value;
      }
      continue;
    }
    if (key === "providerRequestIdPresent") {
      if (typeof value === "boolean") sanitized[key] = value;
      continue;
    }
    if (!SAFE_EVENT_KEYS.has(key)) continue;
    const safeValue = sanitizePrimitive(value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  const error = event["error"];
  if (typeof error === "object" && error !== null) {
    const safeError = error as Record<string, unknown>;
    const kind = sanitizePrimitive(safeError["kind"]);
    const code = sanitizePrimitive(safeError["code"]);
    const retryable = sanitizePrimitive(safeError["retryable"]);
    sanitized["error"] = {
      ...(kind === undefined ? {} : { kind }),
      ...(code === undefined ? {} : { code }),
      ...(retryable === undefined ? {} : { retryable }),
    };
  }
  return sanitized;
}

export function sanitizeLogBindings(bindings: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (!SAFE_BINDING_KEYS.has(key)) continue;
    const safeValue = sanitizePrimitive(value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
}
