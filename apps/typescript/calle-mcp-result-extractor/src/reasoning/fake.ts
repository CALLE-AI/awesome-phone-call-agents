import type { z } from "zod";
import {
  ReasoningValidationError,
  type ReasoningProvider,
  type StructuredCompletionRequest,
} from "./types.js";

/**
 * Deterministic, zero-network reasoning provider for the demo and the test
 * suite. Register a canned response per task name; `complete()` validates it
 * against the requested schema so a mismatched fixture fails loudly instead
 * of silently returning bad data. No credentials, no outbound HTTP calls.
 */
export class FakeReasoningProvider implements ReasoningProvider {
  readonly name = "fake";
  private readonly responses = new Map<string, unknown>();

  register(task: string, response: unknown): this {
    this.responses.set(task, response);
    return this;
  }

  async complete<TSchema extends z.ZodTypeAny>(
    request: StructuredCompletionRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    if (!this.responses.has(request.task)) {
      throw new ReasoningValidationError(
        request.task,
        `No fake response registered for task "${request.task}". ` +
          "Call .register(task, response) before using FakeReasoningProvider.",
      );
    }
    const parsed = request.schema.safeParse(this.responses.get(request.task));
    if (!parsed.success) {
      throw new ReasoningValidationError(request.task, parsed.error.message);
    }
    return parsed.data as z.infer<TSchema>;
  }
}
