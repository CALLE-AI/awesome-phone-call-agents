import { z } from "zod";

export const TASK_VERSION = "task_v1";
export const SCHEMA_VERSION = "recipient_result_v1";
export const AUTHORIZATION_VERSION = "auth_v1";
export const CONFIDENCE_THRESHOLD = 0.7;

export const recipientResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "organization_identity",
    "change_request_status",
    "safe_case_code_confirmed",
    "sensitive_data_disclosed",
    "recipient_opt_out",
  ],
  properties: {
    organization_identity: {
      type: "string",
      enum: ["confirmed", "not_confirmed", "unknown"],
    },
    change_request_status: {
      type: "string",
      enum: ["initiated", "not_initiated", "unable_to_verify", "unknown"],
    },
    safe_case_code_confirmed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
    sensitive_data_disclosed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
    recipient_opt_out: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
  },
} as const;

export const structuredResultValidator = z
  .object({
    organization_identity: z.enum(["confirmed", "not_confirmed", "unknown"]),
    change_request_status: z.enum(["initiated", "not_initiated", "unable_to_verify", "unknown"]),
    safe_case_code_confirmed: z.enum(["yes", "no", "unknown"]),
    sensitive_data_disclosed: z.enum(["yes", "no", "unknown"]),
    recipient_opt_out: z.enum(["yes", "no", "unknown"]),
  })
  .strict();

export type StructuredResult = z.infer<typeof structuredResultValidator>;
