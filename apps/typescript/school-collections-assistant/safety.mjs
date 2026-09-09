import { createHash, timingSafeEqual } from "node:crypto";

/** Strict ASCII E.164: +, non-zero country digit, then 7–14 digits. */
export const E164_RE = /^\+[1-9][0-9]{7,14}$/;

export function isE164(value) {
  return typeof value === "string" && E164_RE.test(value);
}

export function maskPhone(value) {
  const phone = String(value || "");
  if (!isE164(phone)) return "[phone masked]";
  return `${phone.slice(0, 3)}${"•".repeat(Math.max(2, phone.length - 6))}${phone.slice(-3)}`;
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
    structuredResult: {
      payment_awareness: "yes",
      will_pay: "yes",
      payment_date: fields.dueDate,
      parent_response:
        "Fake dry-run only. No phone call was placed. The parent confirmed awareness in this synthetic result.",
    },
    evidence: [],
  };
}
