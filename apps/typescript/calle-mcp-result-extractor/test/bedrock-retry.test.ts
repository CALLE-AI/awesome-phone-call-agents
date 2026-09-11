import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { BedrockReasoningProvider } from "../src/reasoning/bedrock.js";

/**
 * Regression coverage for a real Converse API constraint: once the model
 * returns a tool_use content block, the very next message must be a
 * tool_result for that same toolUseId, or the API rejects the request with
 * "An assistant message with tool_use blocks must be followed by a user
 * message with tool_result blocks." See ../docs/bedrock-tool-result-retry.md.
 *
 * These tests stub BedrockRuntimeClient.send() so they run with no AWS
 * credentials and no network access.
 */

interface StubResponse {
  output?: { message?: { content: unknown[] } };
}

class StubBedrockClient {
  public readonly sentInputs: unknown[] = [];
  private readonly responses: StubResponse[];

  constructor(responses: StubResponse[]) {
    this.responses = responses;
  }

  async send(command: { input: unknown }): Promise<StubResponse> {
    this.sentInputs.push(command.input);
    const next = this.responses.shift();
    if (!next) {
      throw new Error("StubBedrockClient ran out of canned responses.");
    }
    return next;
  }
}

const Schema = z.object({ confirmed: z.boolean() });

function toolUseResponse(toolUseId: string, input: unknown): StubResponse {
  return { output: { message: { content: [{ toolUse: { toolUseId, input } }] } } };
}

test("retries an invalid tool input by sending a paired tool_result, not free text", async () => {
  const client = new StubBedrockClient([
    toolUseResponse("call-1", { confirmed: "not-a-boolean" }), // fails schema
    toolUseResponse("call-2", { confirmed: true }), // succeeds
  ]);
  const provider = new BedrockReasoningProvider({
    client: client as never,
    modelId: "test-model",
  });

  const result = await provider.complete({
    task: "confirm",
    systemPrompt: "system",
    userPrompt: "user",
    schema: Schema,
  });

  assert.deepEqual(result, { confirmed: true });
  assert.equal(client.sentInputs.length, 2);

  // The second request must append the failed assistant turn immediately
  // followed by a user turn carrying a toolResult for the SAME toolUseId —
  // never a plain-text user message after a tool_use block.
  const secondRequest = client.sentInputs[1] as { messages: Array<Record<string, unknown>> };
  const appendedMessages = secondRequest.messages.slice(-2);
  assert.equal(appendedMessages[0]!.role, "assistant");
  assert.equal(appendedMessages[1]!.role, "user");
  const toolResultBlock = (appendedMessages[1]!.content as Array<{ toolResult?: { toolUseId: string; status: string } }>)[0]!.toolResult;
  assert.equal(toolResultBlock?.toolUseId, "call-1");
  assert.equal(toolResultBlock?.status, "error");
});

test("retries from the original prompt (no unpaired assistant turn) when no tool_use comes back", async () => {
  const client = new StubBedrockClient([
    { output: { message: { content: [{ text: "I'd rather just explain in prose." }] } } },
    toolUseResponse("call-2", { confirmed: true }),
  ]);
  const provider = new BedrockReasoningProvider({
    client: client as never,
    modelId: "test-model",
  });

  const result = await provider.complete({
    task: "confirm",
    systemPrompt: "system",
    userPrompt: "user",
    schema: Schema,
  });

  assert.deepEqual(result, { confirmed: true });
  // No unpaired assistant tool_use turn was appended — both requests carry
  // only the original single user message.
  for (const input of client.sentInputs) {
    const messages = (input as { messages: unknown[] }).messages;
    assert.equal(messages.length, 1);
  }
});

test("throws a labelled validation error after exhausting retries", async () => {
  const client = new StubBedrockClient([
    toolUseResponse("call-1", { confirmed: "nope" }),
    toolUseResponse("call-2", { confirmed: "still-nope" }),
  ]);
  const provider = new BedrockReasoningProvider({
    client: client as never,
    modelId: "test-model",
    maxAttempts: 2,
  });

  await assert.rejects(
    provider.complete({ task: "confirm", systemPrompt: "s", userPrompt: "u", schema: Schema }),
    /confirm/,
  );
});
