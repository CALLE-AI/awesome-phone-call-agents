import { CalleValidationError } from "./errors";
import type { JsonSchema } from "./types";

export function assertSupportedResultSchema(
  schema: JsonSchema | undefined,
  path = "$",
  seen = new Set<object>(),
) {
  if (!schema) return;
  if (typeof schema !== "object") {
    throw new CalleValidationError(`Invalid result schema at ${path}`);
  }
  if (seen.has(schema)) {
    throw new CalleValidationError(`Recursive result schema at ${path}`);
  }
  seen.add(schema);
  if (schema.additionalProperties === true) {
    throw new CalleValidationError(`additionalProperties must not be true at ${path}`);
  }
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      assertSupportedResultSchema(value, `${path}.properties.${key}`, seen);
    }
  }
  if (schema.items) {
    assertSupportedResultSchema(schema.items, `${path}.items`, seen);
  }
  seen.delete(schema);
}

export const auntyCareResultSchema: JsonSchema = {
  type: "object",
  required: ["request_type", "outcome", "follow_up_required"],
  additionalProperties: false,
  properties: {
    request_type: {
      type: "string",
      enum: ["check_in", "appointment", "reminder", "family_update", "other"],
    },
    outcome: {
      type: "string",
      enum: ["completed", "needs_follow_up", "no_answer", "unknown"],
    },
    follow_up_required: { type: "string", enum: ["yes", "no", "unknown"] },
    summary: { type: "string" },
    preferred_callback_window: { type: "string" },
  },
};

export const callDecisionResultSchema: JsonSchema = {
  type: "object",
  required: ["decision", "confidence", "summary"],
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["yes", "no", "unknown"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string" },
  },
};
