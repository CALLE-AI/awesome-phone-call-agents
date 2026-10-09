import { createHash } from "node:crypto";
import type { CreateCallRequest } from "./types";
import { e164PhoneSchema } from "./types";

export type RecipientAuthorityRecord = {
  phoneFingerprint: string;
  authorized: boolean;
  authorizationSource: "workflow" | "operator" | "test" | "none";
  expiresAt?: string;
};

export type RecipientAuthority = {
  isAuthorized(phone: string, context: { requestSource: string }): boolean;
};

export function fingerprintRecipient(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

export function validateRecipientPhones(request: CreateCallRequest): string[] {
  const errors: string[] = [];
  for (const [index, recipient] of request.recipients.entries()) {
    for (const phone of recipient.phones) {
      if (!e164PhoneSchema.safeParse(phone).success) {
        errors.push(`recipients[${index}].phones contains an invalid E.164 value`);
      }
    }
  }
  return errors;
}

export function recipientAuthorizationFromMetadata(request: CreateCallRequest): boolean {
  const metadata = request.metadata ?? {};
  return (
    metadata.recipient_authorized === "true" &&
    metadata.recipient_authorization_source === "workflow"
  );
}

export function authorizeDirectRecipientSet(
  request: CreateCallRequest,
  options: { loopbackScope: boolean; operatorAuthorized: boolean },
): { authorized: boolean; valid: boolean; reason: string } {
  const validationErrors = validateRecipientPhones(request);
  if (validationErrors.length > 0) {
    return { authorized: false, valid: false, reason: "Recipient must be valid E.164." };
  }

  // Direct use is limited to a loopback operator by default. Browser and mobile workflows
  // remain on protected tRPC procedures, which carry consent and user authorization.
  if (options.loopbackScope && options.operatorAuthorized) {
    return { authorized: true, valid: true, reason: "Loopback operator scope." };
  }

  if (options.operatorAuthorized && recipientAuthorizationFromMetadata(request)) {
    return { authorized: true, valid: true, reason: "Trusted workflow authorization marker." };
  }

  return {
    authorized: false,
    valid: true,
    reason: "Recipient authorization was not established by a trusted path.",
  };
}

export function maskPhoneForResponse(phone: string): string {
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}
