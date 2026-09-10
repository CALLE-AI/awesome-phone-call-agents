import { assertStrictE164, maskPhoneNumber, redactPhoneNumbers } from "../safety/phone";

export interface OutboundCallRequest {
  readonly destinationE164: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROHIBITED_PURPOSE = /\b(?:diagnos(?:e|is)|medication change|emergency|legal advice|financial advice|investment advice|impersonat(?:e|ion)|password|api key|secret|token)\b/i;

export function validateOutboundCallRequest(request: OutboundCallRequest): OutboundCallRequest {
  assertStrictE164(request.destinationE164);
  if (!IDEMPOTENCY_KEY.test(request.idempotencyKey)) throw new Error("invalid idempotency key");
  if (request.purpose.trim() !== request.purpose || request.purpose.length < 1 || request.purpose.length > 300) {
    throw new Error("call purpose must be non-empty, bounded, and trimmed");
  }
  if (redactPhoneNumbers(request.purpose) !== request.purpose) {
    throw new Error("put only the confirmed destination in the phone field");
  }
  if (PROHIBITED_PURPOSE.test(request.purpose)) {
    throw new Error("call purpose is outside the supported safety boundary");
  }
  return request;
}

export function outboundCallPreview(request: OutboundCallRequest) {
  const validated = validateOutboundCallRequest(request);
  return {
    destinationSummary: maskPhoneNumber(validated.destinationE164),
    purpose: validated.purpose,
  };
}
