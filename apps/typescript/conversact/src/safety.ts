import type { CallConsent } from "./types.js";

const E164 = /^\+[1-9]\d{6,14}$/;

export class SafetyError extends Error {}

export function assertE164(phone: string): string {
  if (!E164.test(phone)) {
    throw new SafetyError("recipient phone must be strict E.164, for example +14155550100. Country codes are never inferred.");
  }
  return phone;
}

export function maskPhone(phone: string): string {
  assertE164(phone);
  return `${phone.slice(0, 2)}••••••••${phone.slice(-2)}`;
}

/** Terminal text only; private evidence and commerce decisions stay unchanged. */
export function redactDisplay(text: string, secrets: readonly string[] = []): string {
  let output = text;
  for (const secret of secrets) if (secret) output = output.split(secret).join("[credential redacted]");
  output = output.replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [credential redacted]");
  return output.replace(/(?<!\w)(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]*){2,4}\d{2,4}(?!\w)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? "[phone masked]" : match;
  });
}

export function providerIdempotencyKey(sessionId: string): string {
  if (!/^cv_[A-Za-z0-9_-]{3,64}$/.test(sessionId)) {
    throw new SafetyError("session id must start with cv_ and contain only letters, digits, underscores, or hyphens.");
  }
  return `conversact:${sessionId}:call:v1`;
}

export function assertUsableConsent(consent: CallConsent, recipientPhone: string): void {
  assertE164(recipientPhone);
  if (consent.purpose !== "conversational_checkout") {
    throw new SafetyError("call consent is not authorized for conversational checkout.");
  }
  if (consent.recipientPhone !== recipientPhone) {
    throw new SafetyError("call consent recipient does not match the requested recipient.");
  }
  if (consent.consumedAt !== undefined) {
    throw new SafetyError("call consent has already been consumed and cannot create another logical call.");
  }
}

export function consumeConsent(consent: CallConsent, at = new Date().toISOString()): CallConsent {
  return { ...consent, consumedAt: at };
}
