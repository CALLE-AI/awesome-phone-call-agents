import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ReasoningValidationError,
  type ReasoningProvider,
  type StructuredCompletionRequest,
} from "./types.js";

export interface BedrockReasoningProviderConfig {
  /** Inference-profile or model id; default from BEDROCK_MODEL_ID env var. */
  modelId?: string;
  region?: string;
  client?: BedrockRuntimeClient;
  /** One retry with validation feedback is attempted by default. */
  maxAttempts?: number;
}

const DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

/**
 * AWS Bedrock Converse API adapter. Structured output is enforced by forcing
 * a single tool call whose input schema is the requested Zod schema
 * (converted to JSON Schema); the tool input is re-validated with Zod before
 * returning. Auth is whatever the AWS SDK default credential chain resolves
 * (profile, execution role, etc.) — never a hardcoded key.
 *
 * The retry path exists because of a real Converse API constraint that is
 * easy to get wrong: once the model returns a `tool_use` content block, the
 * *next* message in the conversation must be a `tool_result` for that same
 * `toolUseId`, or the API rejects the whole request. Sending a follow-up as
 * plain user text (e.g. "that wasn't valid JSON, try again") throws
 * `ValidationException: An assistant message with tool_use blocks must be
 * followed by a user message with tool_result blocks`. See
 * ../../docs/bedrock-tool-result-retry.md for the full writeup.
 */
export class BedrockReasoningProvider implements ReasoningProvider {
  readonly name = "bedrock";
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxAttempts: number;

  constructor(config: BedrockReasoningProviderConfig = {}) {
    this.modelId = config.modelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.client =
      config.client ?? new BedrockRuntimeClient(config.region ? { region: config.region } : {});
  }

  async complete<TSchema extends z.ZodTypeAny>(
    request: StructuredCompletionRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const toolName = `emit_${request.task.replaceAll(/[^a-zA-Z0-9]+/g, "_")}`;
    const jsonSchema = zodToJsonSchema(request.schema, { target: "jsonSchema7" });
    const tool: Tool = {
      toolSpec: {
        name: toolName,
        description: `Return the ${request.task} result in the required structure.`,
        inputSchema: { json: jsonSchema as DocumentType },
      },
    };

    const messages: Message[] = [{ role: "user", content: [{ text: request.userPrompt }] }];
    let lastIssues = "";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: request.systemPrompt }],
          messages,
          toolConfig: { tools: [tool], toolChoice: { tool: { name: toolName } } },
          inferenceConfig: {
            maxTokens: request.maxTokens ?? 2048,
            temperature: request.temperature ?? 0,
          },
        }),
      );

      const content = response.output?.message?.content ?? [];
      const toolUse = content.find((block) => block.toolUse !== undefined)?.toolUse;
      const parsed = request.schema.safeParse(toolUse?.input);
      if (parsed.success) {
        return parsed.data as z.infer<TSchema>;
      }

      if (!toolUse?.toolUseId) {
        // No tool_use block to pair a tool_result with — retry from the
        // original prompt rather than appending an unpaired assistant turn,
        // which the Converse API would reject on the next call.
        lastIssues = "Model did not return a tool_use block for the requested tool.";
        continue;
      }

      lastIssues = parsed.error.message;
      // Feed validation issues back as a tool_result (required immediately
      // after a tool_use block) for one corrective attempt.
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: toolUse.toolUseId,
                status: "error",
                content: [
                  {
                    text:
                      `Your ${toolName} input failed validation. Fix these issues and call the ` +
                      `tool again with a corrected, complete input:\n${lastIssues}`,
                  },
                ],
              },
            },
          ],
        },
      );
    }

    throw new ReasoningValidationError(request.task, lastIssues);
  }
}
