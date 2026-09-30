# CALL-E integration boundary

Verified against the public CALL-E documentation on 2026-09-11.

Senior Phone AI uses the supported one-shot Calls REST API for its application backend:

- `POST /v1/calls` accepts one asynchronous call task and a stable idempotency key.
- `GET /v1/calls/{call_id}` returns the current task, recipient and attempt state.
- `GET /v1/calls/{call_id}/events` returns developer-facing events.
- Published task states are `queued`, `in_progress`, `completed`, `failed` and `canceled`.

The public API does not publish stable no-answer or voicemail enums. It publishes terminal summaries,
task completion evidence and opaque failure diagnostics. The app therefore reports a coarse
`incomplete` outcome when a completed task is not affirmatively complete and displays only a bounded,
redacted summary for additional context. It does not infer a no-answer or voicemail result from
undocumented diagnostic strings.

CALL-E's public integration repository confirms that its agent/CLI path exposes `plan_call`,
`run_call` and `get_call_run`. Planning has no call side effect, while execution can place a real
call. The public material does not publish a stable JSON schema for those MCP tools. This app does
not treat the MCP contract as equivalent to the Calls REST contract and does not shell out to the CLI.

The offline fake provider implements the fixed Calls API origin in memory. It advances scripted
snapshots, reads no credentials and opens no network connection. Automated tests use it for queued
and terminal outcome behavior. Live credentials and real outbound calls are never required by the
default test command.

Create-call acceptance may take longer than ordinary status reads. The app does not impose its own
timeout on call creation; it waits for CALL-E or the underlying network connection to return. It never
retries in the background. If the network still produces an uncertain failure and the operator reviews
and confirms the same unchanged intent again, the registry reuses the original idempotency key so
CALL-E returns the existing call when it already accepted the request instead of creating a duplicate.

Sources:

- [CALL-E Developer API: Calls](https://docs.heycall-e.com/api-reference/calls)
- [CALL-E Developer API quickstart](https://docs.heycall-e.com/)
- [CALL-E integrations repository](https://github.com/CALLE-AI/call-e-integrations)
