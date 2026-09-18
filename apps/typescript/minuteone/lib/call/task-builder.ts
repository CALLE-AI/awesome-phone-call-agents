import type { BusinessConfig } from "../config/schema";
import type { JsonSchema } from "./provider";

export interface CallTaskSpec {
  task: string;
  resultSchema: JsonSchema;
}

/**
 * Turns the config-driven business identity + questions into the natural-language task and
 * JSON Schema CALL-E needs. No hardcoded scripts — everything comes from the business config.
 */
export function buildCallTask(config: BusinessConfig, leadName: string): CallTaskSpec {
  const questionLines = config.questions
    .map((q, i) => `${i + 1}. (${q.id}) ${q.prompt}`)
    .join("\n");

  const properties: Record<string, JsonSchema> = {
    reached_person: { type: "boolean", description: "Did a human engage with the call?" },
    declined_conversation: {
      type: "boolean",
      description: "Did the person decline to continue / ask not to be called?",
    },
    wants_callback_later: {
      type: "boolean",
      description: "Did they ask to be called back at a different time instead of continuing?",
    },
  };

  for (const q of config.questions) {
    properties[q.id] =
      q.type === "single_select"
        ? { type: "string", enum: q.options ?? [], description: q.prompt }
        : { type: q.type === "boolean" ? "boolean" : q.type === "number" ? "number" : "string", description: q.prompt };
  }

  // CALL-E's plan_call has no structured-result-schema parameter, so the exact field keys it
  // should use in `extracted` have to be spelled out in the goal text itself, not just implied.
  const fieldSpecLines = Object.entries(properties).map(
    ([key, schema]) => `- ${key} (${describeFieldType(schema)}): ${schema.description as string}`,
  );

  const task = [
    `You are calling ${leadName} on behalf of ${config.business.name}.`,
    `Opening line: "${config.business.openingLine}"`,
    "If they don't answer, mark reached_person as false and stop.",
    "If they ask you to stop calling or decline to continue, mark declined_conversation as true and stop.",
    "Otherwise, naturally work these questions into the conversation and record their answers:",
    questionLines,
    "If they'd rather be called back at a specific time instead of continuing now, set wants_callback_later to true.",
    "Report the outcome as structured data using exactly these field keys (do not rename or nest them):",
    ...fieldSpecLines,
  ].join("\n");

  const resultSchema: JsonSchema = {
    type: "object",
    required: ["reached_person", "declined_conversation"],
    properties,
  };

  return { task, resultSchema };
}

function describeFieldType(schema: JsonSchema): string {
  const enumValues = schema.enum as string[] | undefined;
  if (enumValues && enumValues.length > 0) return `one of: ${enumValues.join(", ")}`;
  return schema.type === "boolean" ? "boolean" : schema.type === "number" ? "number" : "text";
}
