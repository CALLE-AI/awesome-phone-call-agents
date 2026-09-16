# The Converse API tool_use / tool_result pairing rule

When you force structured output from AWS Bedrock's Converse API by requiring a tool call
(`toolChoice: { tool: { name } }`), and the model's tool input fails your schema validation, the
obvious next move is to send it back with feedback: "that wasn't valid, try again." Sending that
feedback as an ordinary user text message is the wrong move, and it fails in a way that's easy to
misdiagnose.

## What goes wrong

```ts
messages.push(
  { role: "assistant", content: response.output.message.content }, // has a tool_use block
  { role: "user", content: [{ text: "That was invalid JSON, please retry." }] }, // plain text
);
```

The next `ConverseCommand` call throws:

```
ValidationException: An assistant message with tool_use blocks must be followed by a
user message with tool_result blocks.
```

The Converse API enforces this pairing strictly: any assistant turn containing a `tool_use`
content block must be immediately followed by a user turn containing a `tool_result` block for
that exact `toolUseId`. A plain-text follow-up breaks the pairing and the whole request is
rejected — including the retry you were trying to make, which defeats the purpose of retrying at
all.

## The fix

Send the validation failure as a `toolResult` with `status: "error"`, keyed to the original
`toolUseId`:

```ts
messages.push(
  { role: "assistant", content },
  {
    role: "user",
    content: [
      {
        toolResult: {
          toolUseId: toolUse.toolUseId,
          status: "error",
          content: [{ text: `Your input failed validation: ${issues}` }],
        },
      },
    ],
  },
);
```

The model receives this exactly like a tool execution that failed, and correctly retries the tool
call with corrected input on the next turn.

## The other edge case

Sometimes the model doesn't return a `tool_use` block at all — no forced-tool-choice guarantee
survives every model/prompt combination. In that case there is no `toolUseId` to pair a
`tool_result` with, so appending anything is unsafe. The correct move is to drop back to the
original single-message conversation and retry from scratch, not to keep extending a message list
that has no valid tool_use/tool_result pairing to build on.

See [`../src/reasoning/bedrock.ts`](../src/reasoning/bedrock.ts) for the full implementation and
[`../test/bedrock-retry.test.ts`](../test/bedrock-retry.test.ts) for regression tests covering
both paths against a stubbed client (no AWS credentials needed to run them).
