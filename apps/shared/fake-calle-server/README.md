# fake-calle-server

A local fake of the CALL-E Developer API for tests and demos. Zero
dependencies (Node built-ins only), no real credentials, no real calls.
Omit `webhook_url` for offline operation: configuring it requests real HTTP(S)
POSTs to that destination, so use only synthetic data and a test receiver.

Many apps in this repository need to test CALL-E integrations without live
credentials or outbound calls, and today each one bundles its own mock with
slightly different statuses, idempotency behavior, and webhook shapes. This is
a shared, fixture-grade test double that any app can point at.

## What it implements

| Endpoint | Behavior |
| --- | --- |
| `POST /v1/calls` | Creates a call task. Honors `Authorization: Bearer` and `Idempotency-Key` headers, validates E.164 recipients, `result_schema`, `recipient_result_schema`, `webhook_url`, `ttl_seconds`, and fake-only scenario controls. |
| `GET /v1/calls/{call_id}` | Returns the call. Walks `queued -> preparing -> in_progress -> terminal`. Terminal payloads carry `task_completed`, `completion_confidence`, `evidence`, `structured_result`, and per-recipient `attempts[].transcript_turns`, matching the documented example response shape. |
| `GET /v1/calls/{call_id}/events` | Lists developer-facing events. Supports `?limit=`. |
| `GET /healthz` | Readiness probe (fake-only). |

Shape sources this fake follows (it is not a specification, and it is not a
substitute for the real service):

- CALL-E Integrations README, "API" section:
  https://github.com/CALLE-AI/call-e-integrations#api
- `packages/cli/docs/cli-reference.md` in the same repository.

Statuses are lowercase (`completed`, `no_answer`, ...), matching the documented
example response. A deliberately chosen alias test case is included: the `no_answer`
scenario emits an event whose message carries the raw `NO ANSWER` form, so
clients can test status normalization.

## Deliberate test scenarios

These are fixture behaviors for exercising defensive integrations, not guarantees
of current live-service behavior. The linked upstream documentation remains authoritative.

- **Unsigned webhooks.** Terminal webhooks carry a `CALL-E-Event-Id` header but
  no signature. The intended pattern is to treat the webhook as a hint and
  re-fetch `GET /v1/calls/{call_id}` for authoritative state; the test suite
  exercises exactly that.
- **At-least-once delivery.** `metadata.webhook_repeat` (1-5) sends the same
  terminal event multiple times with distinct event ids in this fake, so dedup logic can be
  tested.
- **`ttl_seconds` bounds queryability.** After the retention window elapses,
  `GET` returns `404` with error code `expired`.
- **Non-terminal statuses are progress, not results.** `COMPLETED` does not
  mean the task succeeded; check `task_completed` and the transcript.

## Run

Requires Node.js 18 or newer. No install step.

```bash
# Terminal 1: start the server (binds 127.0.0.1:8787 by default)
node fake-calle-server.mjs

# Terminal 2: run the smoke client
node examples/smoke-client.mjs
```

Run the tests (12 offline tests, loopback only):

```bash
npm test
```

### Configuration

| Flag | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--port` | `FAKE_CALLE_PORT` | `8787` | Listen port. |
| `--host` | `FAKE_CALLE_HOST` | `127.0.0.1` | Bind address. Localhost by default. |
| `--api-key` | `FAKE_CALLE_API_KEY` | none | When set, requests must carry exactly this Bearer token. Any non-empty token is accepted otherwise. |
| `--terminal-delay-ms` | `FAKE_CALLE_TERMINAL_DELAY_MS` | `1200` | Default time to terminal status. |

### Scenarios (fake-only controls in `metadata`)

| `metadata.scenario` | Terminal | Notes |
| --- | --- | --- |
| `completed` (default) | `completed` | `task_completed: true`, high confidence, schema-filled results, anchored transcript. |
| `completed_low_confidence` | `completed` | Same, with confidence score 0.41 (`low`) for threshold testing. |
| `no_answer` | `no_answer` | Event message carries the raw `NO ANSWER` alias. |
| `voicemail` / `busy` / `declined` / `failed` / `canceled` | same name | `task_completed: false`, null results, attempt `failure_code` set. |

Additional controls: `metadata.terminal_delay_ms`, `metadata.progress_delay_ms`
(stretch the non-terminal window), `metadata.webhook_repeat` (duplicate webhook
deliveries).

Transcripts, structured results, and evidence are synthesized deterministically
from the task text and scenario, so the same task and scenario always replay
the same way. Evidence strings quote turns the fake recipient actually spoke,
so transcript-grounding verification can be tested against them.

## Setup, side effects, credentials, cancellation

- **Setup:** none beyond Node.js. No install, no environment variables required.
- **Side effects:** binds to `127.0.0.1` by default and never places a real
  call. Supplying `webhook_url` sends real HTTP(S) POSTs (and may follow redirects)
  carrying the synthetic payload. Use a local test receiver, or omit the URL
  for offline operation. If you override `--host` you expose this test server
  yourself; do not provide private data, live credentials or production webhooks.
- **Credentials:** none. All phone numbers in examples and fixtures are
  fictional (`+1555555xxxx`).
- **Dry-run behavior:** the server is itself the dry-run target; it exists so
  other apps can test without live credentials.
- **Cancellation / rollback:** state is in-memory only. Stop the process
  (Ctrl+C) and everything is gone; there is no persistence to clean up.
- **Logs:** in-memory only; the CLI prints create/webhook lines to stdout and
  never logs tokens.

## Limitations

- One attempt per recipient; multi-phone fallback sequences are not simulated.
- The real service may differ in undocumented fields. When the upstream
  contract changes, this fake should be updated to follow it; the upstream
  documentation remains the source of truth.
- No authentication flow, no OAuth, no MCP endpoint. It fakes the Developer API
  (REST + webhooks) only. For a fake MCP broker login flow, see
  [`../fake-mcp-broker-server.mjs`](../fake-mcp-broker-server.mjs).
