import { compile, runValidator, type ValidationOutcome } from "./validate.js";

/**
 * Medical-report schema, used when ClaimLine calls the treating doctor or clinic
 * to understand the injuries and treatment for an injury claim. As with the
 * other call types, a compact transmit schema goes to CALL-E and a stricter
 * schema validates the reply.
 */
export const MEDICAL_REPORT_SCHEMA_VERSION = "medical_report.v1";

const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;

// NOTE: the transmit schema sent to CALL-E must use single-value `type`
// (no union arrays like ["string","null"]) — CALL-E rejects array-typed `type`
// with "result_schema is not supported". Optional fields are simply omitted from
// `required`; nullability is enforced locally by the strict schema below.
export const medicalReportTransmitSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["injuries_summary", "accident_consistent"],
  properties: {
    injuries_summary: { type: "string" },
    treatment_provided: { type: "string" },
    accident_consistent: { type: "string", enum: YES_NO_UNKNOWN },
    treatment_ongoing: { type: "string", enum: YES_NO_UNKNOWN },
    expected_recovery: { type: "string" },
    contact_name: { type: "string" },
  },
};

export const medicalReportStrictSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["injuries_summary", "accident_consistent"],
  properties: {
    injuries_summary: { type: "string", minLength: 1, maxLength: 1000 },
    treatment_provided: { type: "string", maxLength: 1000 },
    accident_consistent: { type: "string", enum: YES_NO_UNKNOWN },
    treatment_ongoing: { type: "string", enum: YES_NO_UNKNOWN },
    expected_recovery: { type: "string", maxLength: 500 },
    contact_name: {
      anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }],
    },
  },
};

const validateStrict = compile(medicalReportStrictSchema);

export function validateMedicalReportResult(data: unknown): ValidationOutcome {
  return runValidator(validateStrict, data);
}

export interface MedicalReportResult {
  injuries_summary: string;
  treatment_provided?: string;
  accident_consistent: (typeof YES_NO_UNKNOWN)[number];
  treatment_ongoing?: (typeof YES_NO_UNKNOWN)[number];
  expected_recovery?: string;
  contact_name?: string | null;
}
