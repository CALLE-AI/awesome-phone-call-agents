import type { z } from "zod";

/**
 * One structured-extraction request: a task label (used in error messages and
 * as the generated tool name for Bedrock), a system prompt, a user prompt
 * (typically the transcript plus the questions the call was meant to answer),
 * and the Zod schema the result must satisfy.
 */
export interface StructuredCompletionRequest<TSchema extends z.ZodTypeAny> {
  task: string;
  systemPrompt: string;
  userPrompt: string;
  schema: TSchema;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Anything that can turn a prompt into a schema-valid object is a reasoning
 * provider — Bedrock, OpenAI, a local model, or the fake provider used for
 * offline demos and tests. Swap providers without touching extraction logic.
 */
export interface ReasoningProvider {
  readonly name: string;
  complete<TSchema extends z.ZodTypeAny>(
    request: StructuredCompletionRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;
}

export class ReasoningValidationError extends Error {
  constructor(
    public readonly task: string,
    public readonly issues: string,
  ) {
    super(`Reasoning provider could not produce a valid "${task}" result: ${issues}`);
    this.name = "ReasoningValidationError";
  }
}
