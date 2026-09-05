const CREDENTIAL_PATTERNS = [
  /\b(?:password|passcode|api[_ -]?key|secret|token|pin)\b/i,
  /\b(?:bank account|routing number|card number|cvv|iban|cbu|cvu)\b/i,
];

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /forget\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /override\s+(?:your|all)\s+(?:rules|instructions|safety)/i,
];

const RESTRICTED_USE_PATTERNS = [
  /\b(?:medical|doctor|patient|diagnos(?:e|is)|treatment|prescription|healthcare)\b/i,
  /\b(?:legal|lawyer|attorney|court|lawsuit|contract dispute)\b/i,
  /\b(?:financial|loan|credit|investment|banking|insurance claim|payment)\b/i,
  /\b(?:emergency|police|ambulance|fire department|911|112)\b/i,
];

export const isE164 = (value) => /^\+[1-9]\d{7,14}$/.test(String(value || ""));

export const maskPhone = (value) => {
  const phone = String(value || "");
  if (phone.length < 7) return "••••";
  return `${phone.slice(0, 4)}${"•".repeat(Math.max(2, phone.length - 7))}${phone.slice(-3)}`;
};

const normalizeFieldKey = (key) => String(key || "")
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .replace(/[\s-]+/g, "_")
  .toLowerCase();
const PHONE_FIELD_PATTERN = /(?:^|_)(?:phone|mobile|telephone|tel)(?:$|_)/;
const PHONE_CONTEXT_FIELD_PATTERN = /^(?:recipient|callee|caller|contact|destination|source)_(?:phone|number)$/;
const SECRET_FIELD_PATTERN = /^(?:api_key|api_token|api_auth_token|auth_token|authorization|authorization_token|bearer|bearer_token|password|secret|token|client_secret|access_token|calle_api_key|calle_api_token|employe_api_token)$/;
const ENCODED_E164_PHONE_PATTERN = /%2B[1-9]\d{7,14}(?!\d)/gi;
const E164_PHONE_PATTERN = /(?<!\d)\+[1-9]\d{7,14}(?!\d)/g;
const FORMATTED_PHONE_PATTERN = /(?<!\d)(?:\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,4})(?!\d)/g;
const UNFORMATTED_PHONE_PATTERN = /(?<![A-Za-z0-9_])\d{10,15}(?![A-Za-z0-9_])/g;
const BEARER_PATTERN = /(\bBearer\s+)[^\s,;]+/gi;
const SECRET_PATTERN = /(\b(?:CALLE_API_KEY|EMPLOYE_API_TOKEN|api[_ -]?key|api[_ -]?token|authorization|bearer|password|secret|token|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*)[^\s,;]+/gi;

const isPhoneField = (key) => {
  const normalized = normalizeFieldKey(key);
  return PHONE_FIELD_PATTERN.test(normalized) || PHONE_CONTEXT_FIELD_PATTERN.test(normalized);
};

const isSecretField = (key) => {
  const normalized = normalizeFieldKey(key);
  return SECRET_FIELD_PATTERN.test(normalized) || normalized.endsWith("_secret") || normalized.endsWith("_token") || normalized.endsWith("_api_key") || normalized.endsWith("_api_token");
};

const isPhoneLikeNumber = (value) => {
  if (typeof value !== "number" && typeof value !== "bigint") return false;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return false;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
};

export const sanitizeText = (value) => String(value ?? "")
  .replace(ENCODED_E164_PHONE_PATTERN, "[phone masked]")
  .replace(E164_PHONE_PATTERN, (phone) => maskPhone(phone))
  .replace(FORMATTED_PHONE_PATTERN, "[phone masked]")
  .replace(UNFORMATTED_PHONE_PATTERN, "[phone masked]")
  .replace(BEARER_PATTERN, "$1[redacted]")
  .replace(SECRET_PATTERN, "$1[redacted]");

const sanitizePhoneValue = (value, seen) => {
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
    if (digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(trimmed)) return "[phone masked]";
    return sanitizeText(value);
  }
  if (typeof value === "number" || typeof value === "bigint") return "[phone masked]";
  return sanitizeSensitiveData(value, "phone", seen);
};

export const sanitizeSensitiveData = (value, key = "", seen = new WeakSet()) => {
  if (typeof value === "string") {
    return isPhoneField(key) ? sanitizePhoneValue(value, seen) : sanitizeText(value);
  }
  if (value === null || typeof value !== "object") {
    return (isPhoneField(key) || isPhoneLikeNumber(value)) && (typeof value === "number" || typeof value === "bigint")
      ? "[phone masked]"
      : value;
  }
  if (seen.has(value)) return "[circular value redacted]";
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeSensitiveData(item, key, seen));
    seen.delete(value);
    return sanitizedArray;
  }
  const sanitized = Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    isSecretField(entryKey)
      ? "[redacted]"
      : isPhoneField(entryKey)
      ? sanitizePhoneValue(entryValue, seen)
      : sanitizeSensitiveData(entryValue, entryKey, seen),
  ]));
  seen.delete(value);
  return sanitized;
};

export const sanitizeTranscript = (value) => (Array.isArray(value) ? value : [])
  .map((turn) => {
    const sanitized = sanitizeSensitiveData(turn);
    return {
      speaker: typeof sanitized?.speaker === "string" ? sanitized.speaker.slice(0, 40) : "unknown",
      text: typeof sanitized?.text === "string" ? sanitized.text.slice(0, 4000) : "",
    };
  })
  .filter((turn) => turn.text);

export const sanitizeEvidence = (value) => (Array.isArray(value) ? value : [])
  .map((item) => sanitizeSensitiveData(item))
  .slice(0, 100);

const block = (reason) => ({ ok: false, reason });

export const evaluateCallSafety = ({
  employee,
  task,
  managerApproved = false,
  idempotencyKey,
  recurring = false,
}) => {
  if (!employee || !isE164(employee.phone)) return block("safety:invalid_e164_phone");
  if (!managerApproved) return block("safety:manager_approval_required");
  if (!idempotencyKey) return block("safety:idempotency_key_required");
  if (!String(task || "").trim()) return block("safety:empty_call_task");
  if (String(task).length > 4000) return block("safety:call_task_too_long");
  if (recurring) return block("safety:recurring_calls_not_supported");
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(task))) return block("safety:sensitive_data_in_task");
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(task))) return block("safety:injection_like_task");
  if (RESTRICTED_USE_PATTERNS.some((pattern) => pattern.test(task))) return block("safety:restricted_high_risk_use_case");
  return { ok: true, reason: "safety:passed" };
};

export const sanitizeError = (error) => {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Unknown provider error";
  return String(message)
    .replace(ENCODED_E164_PHONE_PATTERN, "[phone masked]")
    .replace(E164_PHONE_PATTERN, "[phone masked]")
    .replace(FORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(UNFORMATTED_PHONE_PATTERN, "[phone masked]")
    .replace(BEARER_PATTERN, "$1[redacted]")
    .replace(SECRET_PATTERN, "$1[redacted]")
    .slice(0, 500);
};
