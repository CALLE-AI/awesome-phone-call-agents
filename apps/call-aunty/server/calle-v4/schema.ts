import type { ResultSchema } from "./types";

export const outcomeField = {
  type: "string",
  enum: ["yes", "no", "unknown"],
  description: "Use unknown when evidence is insufficient.",
} as const;

/** Default CALL-E-compatible result schema for follow-up calls. */
export const DEFAULT_RESULT_SCHEMA: ResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reached", "needs_follow_up", "appointment_confirmed"],
  properties: {
    reached: outcomeField,
    needs_follow_up: outcomeField,
    appointment_confirmed: outcomeField,
    preferred_window: {
      type: "string",
      enum: ["morning", "afternoon", "evening", "none", "unknown"],
    },
  },
};

export const DEFAULT_RECIPIENT_RESULT_SCHEMA: ResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reached"],
  properties: {
    reached: outcomeField,
    callback_requested: outcomeField,
  },
};

export function validateSchema(schema: ResultSchema): void {
  if (schema.type !== "object") {
    throw new Error("CALL-E result schemas must be object schemas");
  }
  if ((schema as { additionalProperties?: boolean }).additionalProperties === true) {
    throw new Error("additionalProperties:true is not supported");
  }
  if (schema.properties && typeof schema.properties !== "object") {
    throw new Error("properties must be an object");
  }
  for (const key of schema.required ?? []) {
    if (!(key in schema.properties)) {
      throw new Error(`Required field ${key} missing from properties`);
    }
  }
}
