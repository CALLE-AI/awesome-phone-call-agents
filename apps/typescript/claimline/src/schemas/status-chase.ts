import { compile, runValidator, type ValidationOutcome } from "./validate.js";

/**
 * Claim-status chase schema, used when ClaimLine calls a repair shop, contractor
 * or clinic to learn where a claim's work stands. As with FNOL, a compact
 * transmit schema goes to CALL-E and a stricter schema validates the reply.
 */
export const STATUS_CHASE_SCHEMA_VERSION = "status_chase.v1";

export const WORK_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "unknown",
] as const;

// Transmit schema uses single-value `type` only (CALL-E rejects union arrays).
export const statusChaseTransmitSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["work_status"],
  properties: {
    work_status: { type: "string", enum: WORK_STATUSES },
    eta_date: { type: "string" },
    estimated_cost_amount: { type: "number" },
    estimated_cost_currency: { type: "string" },
    blockers: { type: "string" },
    contact_name: { type: "string" },
  },
};

export const statusChaseStrictSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["work_status"],
  properties: {
    work_status: { type: "string", enum: WORK_STATUSES },
    // Accept an ISO date or null; "unknown" must be expressed via work_status.
    eta_date: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    },
    estimated_cost_amount: {
      anyOf: [{ type: "number", minimum: 0, maximum: 100000000 }, { type: "null" }],
    },
    estimated_cost_currency: {
      anyOf: [
        { type: "string", minLength: 3, maxLength: 3 },
        { type: "null" },
      ],
    },
    blockers: {
      anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }],
    },
    contact_name: {
      anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }],
    },
  },
};

const validateStrict = compile(statusChaseStrictSchema);

export function validateStatusChaseResult(data: unknown): ValidationOutcome {
  return runValidator(validateStrict, data);
}

export interface StatusChaseResult {
  work_status: (typeof WORK_STATUSES)[number];
  eta_date?: string | null;
  estimated_cost_amount?: number | null;
  estimated_cost_currency?: string | null;
  blockers?: string | null;
  contact_name?: string | null;
}
