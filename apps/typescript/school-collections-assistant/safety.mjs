import { createHash, timingSafeEqual } from "node:crypto";

/** Strict ASCII E.164: +, non-zero country digit, then 7–14 digits. */
export const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/** NANP fictional destinations for docs/tests: a normal area code (NPA) plus the reserved 555-01xx exchange/line block. 555 must not be used as the area code. */
export const EXAMPLE_E164 = "+12025550100";
export const EXAMPLE_E164_OTHER = "+12025550199";

const ENCODED_E164_PHONE_PATTERN = /%2B[1-9]\d{7,14}(?!\d)/gi;
const E164_PHONE_PATTERN = /(?<!\d)\+[1-9]\d{7,14}(?!\d)/g;
const FORMATTED_PHONE_PATTERN =
  /(?<!\d)(?:\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,4})(?!\d)/g;
const UNFORMATTED_PHONE_PATTERN = /(?<![A-Za-z0-9_])\d{10,15}(?![A-Za-z0-9_])/g;
const BEARER_PATTERN = /(\bBearer\s+)[^\s,;]+/gi;
const SECRET_PATTERN =
  /(\b(?:CALLE_API_KEY|SCHOOL_COLLECTIONS_API_TOKEN|api[_ -]?key|api[_ -]?token|authorization|bearer|password|secret|token|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*)[^\s,;]+/gi;

const PHONE_FIELD_PATTERN = /(?:^|_)(?:phone|mobile|telephone|tel)(?:$|_)/i;
const PHONE_CONTEXT_FIELD_PATTERN =
  /^(?:recipient|callee|caller|contact|destination|source)_(?:phone|number)$/i;
const SECRET_FIELD_PATTERN =
  /^(?:api_key|api_token|auth_token|authorization|bearer|password|secret|token|access_token|calle_api_key|school_collections_api_token)$/i;

export function isE164(value) {
  return typeof value === "string" && E164_RE.test(value);
}

export function maskPhone(value) {
  const phone = String(value || "");
  if (!isE164(phone)) return "[phone masked]";
  return `${phone.slice(0, 4)}${"•".repeat(Math.max(2, phone.length - 8))}${phone.slice(-4)}`;
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerToken(authorizationHeader) {
  const value = String(authorizationHeader || "").trim();
  const match = value.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

export function isAmbiguousProviderError(error) {
  const status = error?.status ?? error?.statusCode ?? null;
  if (status === null || status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

function normalizeFieldKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function isPhoneField(key) {
  const normalized = normalizeFieldKey(key);
  return (
    PHONE_FIELD_PATTERN.test(normalized) ||
    PHONE_CONTEXT_FIELD_PATTERN.test(normalized)
  );
}

function isSecretField(key) {
  const normalized = normalizeFieldKey(key);
  return (
    SECRET_FIELD_PATTERN.test(normalized) ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_api_key")
  );
}

export function sanitizeText(value) {
  return String(value ?? "")
    .replace(ENCODED_E164_PHONE_PATTERN, "[phone masked]")
    .replace(E164_PHONE_PATTERN, (phone) => maskPhone(phone))
    .replace(FORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(UNFORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(BEARER_PATTERN, "$1[redacted]")
    .replace(SECRET_PATTERN, "$1[redacted]");
}

/** Provider error strings: fully redact phone-like and secret material. */
export function sanitizeError(error) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error?.message
          ? String(error.message)
          : "Unknown provider error";
  return String(message)
    .replace(ENCODED_E164_PHONE_PATTERN, "[phone masked]")
    .replace(E164_PHONE_PATTERN, "[phone masked]")
    .replace(FORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(UNFORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(BEARER_PATTERN, "$1[redacted]")
    .replace(SECRET_PATTERN, "$1[redacted]")
    .slice(0, 500);
}

function sanitizePhoneValue(value, seen) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular value redacted]";
    seen.add(value);
    const sanitizedArray = value.map((item) => sanitizePhoneValue(item, seen));
    seen.delete(value);
    return sanitizedArray;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (isE164(trimmed)) return maskPhone(trimmed);
    if (digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(trimmed)) {
      return "[phone masked]";
    }
    return sanitizeText(value);
  }
  if (typeof value === "number" || typeof value === "bigint") return "[phone masked]";
  return sanitizeSensitiveData(value, "phone", seen);
}

/** Deep-mask phones, secrets, and phone-like strings in provider payloads. */
export function sanitizeSensitiveData(value, key = "", seen = new WeakSet()) {
  if (typeof value === "string") {
    return isPhoneField(key) ? sanitizePhoneValue(value, seen) : sanitizeText(value);
  }
  if (value === null || typeof value !== "object") {
    if (
      (isPhoneField(key) || typeof value === "number" || typeof value === "bigint") &&
      (typeof value === "number" || typeof value === "bigint")
    ) {
      const digits = String(value).replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 15) return "[phone masked]";
    }
    return value;
  }
  if (seen.has(value)) return "[circular value redacted]";
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeSensitiveData(item, key, seen));
    seen.delete(value);
    return sanitizedArray;
  }
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      isSecretField(entryKey)
        ? "[redacted]"
        : isPhoneField(entryKey)
          ? sanitizePhoneValue(entryValue, seen)
          : sanitizeSensitiveData(entryValue, entryKey, seen),
    ])
  );
  seen.delete(value);
  return sanitized;
}

export function sanitizeEvidence(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeSensitiveData(item))
    .slice(0, 100);
}

export function canonicalReminderIntent(fields) {
  return JSON.stringify({
    parentName: String(fields.parentName || "").trim(),
    studentName: String(fields.studentName || "").trim(),
    phoneNumber: String(fields.phoneNumber || "").trim(),
    amount: String(fields.amount || "").trim(),
    dueDate: String(fields.dueDate || "").trim(),
    schoolName: String(fields.schoolName || "").trim(),
    intentId: String(fields.intentId || "").trim(),
  });
}

/** Stable intent key for one authorized reminder run (idempotency). */
export function reminderIntentKey(fields) {
  const digest = createHash("sha256")
    .update(canonicalReminderIntent(fields))
    .digest("hex")
    .slice(0, 24);
  return `school-collections:${digest}`;
}

export function buildReminderTask(fields) {
  const school = fields.schoolName || "the school";
  return `
You are a polite school payment reminder assistant calling on behalf of ${school}.

You are speaking with ${fields.parentName}, the parent or guardian of ${fields.studentName}.

The student's outstanding school payment is ${fields.amount}.
The payment is due on ${fields.dueDate}.

Your task is to:
1. Politely introduce yourself as calling on behalf of the school.
2. Inform the parent about the outstanding payment.
3. Ask whether they are aware of the outstanding balance.
4. Ask when they expect to make the payment.
5. Be polite and understanding.
6. Do not pressure, threaten, or embarrass the parent.
7. Thank them for their time.

If the parent cannot commit to a date, record that appropriately.

Do not make up information that was not provided.
  `.trim();
}

export const RESULT_SCHEMA = {
  type: "object",
  required: ["payment_awareness", "will_pay", "payment_date"],
  properties: {
    payment_awareness: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
    will_pay: {
      type: "string",
      enum: ["yes", "no", "uncertain"],
    },
    payment_date: {
      type: "string",
    },
    parent_response: {
      type: "string",
    },
  },
};

export function fakeReminderResult(fields, intentKey) {
  return {
    success: true,
    mode: "fake",
    realCallPlaced: false,
    intentKey,
    phoneMasked: maskPhone(fields.phoneNumber),
    status: "completed",
    taskCompleted: true,
    completionConfidence: { overall: "high" },
    structuredResult: sanitizeSensitiveData({
      payment_awareness: "yes",
      will_pay: "yes",
      payment_date: fields.dueDate,
      parent_response:
        "Fake dry-run only. No phone call was placed. The parent confirmed awareness in this synthetic result.",
    }),
    evidence: [],
  };
}
