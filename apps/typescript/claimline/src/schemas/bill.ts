import { compile, runValidator, type ValidationOutcome } from "./validate.js";

/**
 * Bill-verification schema, used when ClaimLine calls a hospital billing desk
 * or provider to confirm the amount billed for a claim. The total amount feeds
 * the claim aggregate that a human reviews before sanctioning.
 */
export const BILL_VERIFICATION_SCHEMA_VERSION = "bill_verification.v1";

// Transmit schema uses single-value `type` only (CALL-E rejects union arrays).
export const billVerificationTransmitSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["total_amount"],
  properties: {
    total_amount: { type: "number" },
    currency: { type: "string" },
    service_from_date: { type: "string" },
    service_to_date: { type: "string" },
    itemized_available: { type: "string" },
    contact_name: { type: "string" },
  },
};

export const billVerificationStrictSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["total_amount"],
  properties: {
    total_amount: {
      anyOf: [{ type: "number", minimum: 0, maximum: 100000000 }, { type: "null" }],
    },
    currency: {
      anyOf: [{ type: "string", minLength: 3, maxLength: 3 }, { type: "null" }],
    },
    service_from_date: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    },
    service_to_date: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    },
    itemized_available: {
      anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }],
    },
    contact_name: {
      anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }],
    },
  },
};

const validateStrict = compile(billVerificationStrictSchema);

export function validateBillVerificationResult(data: unknown): ValidationOutcome {
  return runValidator(validateStrict, data);
}

export interface BillVerificationResult {
  total_amount: number | null;
  currency?: string | null;
  service_from_date?: string | null;
  service_to_date?: string | null;
  itemized_available?: string | null;
  contact_name?: string | null;
}
