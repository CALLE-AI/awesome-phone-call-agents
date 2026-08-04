import { MAX_REPLACEMENT_WINDOWS } from "../workflows/appointment-recovery";
import type { RecoveryRequest } from "../types";

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Validate a recovery request. Returns an empty array when the request may proceed to preview. */
export function validateRequest(request: RecoveryRequest, now: Date = new Date()): string[] {
  const errors: string[] = [];

  if (!request.request_key.trim()) errors.push("A request key is required.");
  if (!request.business.name.trim()) errors.push("Business name is required.");
  if (!isIanaTimezone(request.business.timezone)) {
    errors.push("Business timezone must be a valid IANA timezone.");
  }
  if (!isE164(request.business.callback_number_e164)) {
    errors.push("Business callback number must be E.164, for example +6560000000.");
  }
  if (!request.customer.given_name.trim()) errors.push("Customer given name is required.");
  if (!isE164(request.customer.phone_e164)) {
    errors.push("Customer phone number must be E.164, for example +6580000000.");
  }
  if (!request.customer.consent_confirmed) {
    errors.push("You must confirm you have authority and a lawful basis to call this customer.");
  }
  if (!request.appointment.service.trim()) errors.push("Appointment service is required.");
  if (Number.isNaN(Date.parse(request.appointment.original_time))) {
    errors.push("Original appointment time must be a valid ISO 8601 timestamp.");
  }

  if (request.replacement_windows.length === 0) {
    errors.push("At least one replacement window is required.");
  }
  if (request.replacement_windows.length > MAX_REPLACEMENT_WINDOWS) {
    errors.push(`Offer at most ${MAX_REPLACEMENT_WINDOWS} replacement windows.`);
  }
  request.replacement_windows.forEach((window, index) => {
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    const label = `Replacement window ${index + 1}`;
    if (Number.isNaN(start) || Number.isNaN(end)) {
      errors.push(`${label} must use valid ISO 8601 timestamps.`);
      return;
    }
    if (start >= end) errors.push(`${label} must end after it starts.`);
    if (start <= now.getTime()) errors.push(`${label} must be in the future.`);
  });

  return errors;
}
