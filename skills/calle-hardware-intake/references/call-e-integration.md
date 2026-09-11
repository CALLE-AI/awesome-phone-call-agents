# CALL-E Integration Reference

How this skill drives CALL-E to make real phone calls and parse the results.

## Prerequisites

- `calle` CLI installed: `npm install -g @call-e/cli`
- Authenticated once via OAuth: `calle auth login` (opens a browser; there is
  **no** CALL-E API key to paste).

## Call lifecycle

1. **Plan** — `calle call plan --to-phone +15551234567 --goal "<goal>"`
   Returns `plan_id`, `confirm_token`, `ready_to_run`. Never dials. If
   `ready_to_run` is `false`, CALL-E needs clarification (see
   `clarifying_questions`) before it will dial.
2. **Run** — `calle call run --plan-id <plan_id> --confirm-token <token>`
   Returns immediately with `run_id` and status `PREPARING`. The bot is spun
   up and the dial happens asynchronously.
3. **Poll** — `calle call status --run-id <run_id>` every ~5-10s until the
   status reaches a terminal value (e.g. `COMPLETED`). The payload includes the
   full transcript, a summary, and a structured outcome.

## CLI output shape

`calle` wraps every result in an envelope:

```json
{
  "ok": true,
  "result": {
    "content": [{"type": "text", "text": "<json string>"}],
    "structuredContent": { "...": "the real payload" }
  }
}
```

Use `structuredContent` when present, else parse `content[0].text`.
`ok: false` means a logical failure even when the process exits 0.

## MCP tools

The CLI is a thin wrapper over CALL-E's MCP server
(`https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`). Tools available:
`plan_call`, `run_call`, `get_call_run`, `track_ui_events`. The same
plan → run → poll flow is available via `calle mcp call <tool> --args-json ...`.

## Known gotchas

- On Windows, `calle` is an npm `.cmd` shim. Python `subprocess` cannot launch
  `.cmd` files via PATH — resolve the real path and run through `cmd /c`.
- Calls spend one credit each and may reach voicemail; design the goal to
  handle no-answer (CALL-E can leave a short voicemail).
- Keep goal text explicit about what the agent should ask for and when to hang
  up.
