import { CalleValidationError } from "./errors";

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(value: string) {
  const normalized = value.trim().replace(/[().\s-]/g, "");
  if (!E164.test(normalized)) {
    throw new CalleValidationError("Phone number must use E.164 format", {
      expected: "+15551234567",
    });
  }
  return normalized;
}

export function normalizeRecipients(
  recipients: { phones: string[]; region?: string; locale?: string }[],
) {
  return recipients.map((recipient) => ({
    ...recipient,
    phones: recipient.phones.map(normalizePhone),
    region: recipient.region?.toUpperCase(),
  }));
}

export function redactPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : `••••••${digits.slice(-4)}`;
}
