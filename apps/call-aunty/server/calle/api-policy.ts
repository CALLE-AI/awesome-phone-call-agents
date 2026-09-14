import { calleConfig } from "./config";
import { CalleValidationError } from "./errors";
import { normalizeRecipients } from "./phone";
import { assertSupportedResultSchema } from "./schema";
import type { CreateCallRequest } from "./types";

const FORBIDDEN = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bpin\b/i,
  /\bverification code\b/i,
  /\bcredit card\b/i,
  /\bcard number\b/i,
  /\bssn\b/i,
  /\bbank account\b/i,
  /\brouting number\b/i,
];

export function validateCallPolicy(request: CreateCallRequest): CreateCallRequest {
  if (request.task.length > 20_000) {
    throw new CalleValidationError("Task is too long");
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(request.task)) {
      throw new CalleValidationError(
        "Task contains sensitive credential/payment disclosure instructions",
      );
    }
  }
  assertSupportedResultSchema(request.resultSchema);
  assertSupportedResultSchema(request.recipientResultSchema);
  const recipients = normalizeRecipients(request.recipients);
  for (const recipient of recipients) {
    if (recipient.region && !calleConfig.allowedRegions.has(recipient.region)) {
      throw new CalleValidationError(
        `Calling region ${recipient.region} is not enabled by app policy`,
      );
    }
  }
  return { ...request, recipients };
}
