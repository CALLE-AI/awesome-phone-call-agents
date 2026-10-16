# calle-ai SDK API Reference

Reverse-engineered from the published `calle-ai` package (v0.6.0) by downloading and inspecting the wheel — the source repo (`CALLE-AI/server-sdk-python`) is private/404 on GitHub, so this reference is the authoritative surface.

- **Package**: `calle-ai` → `pip install calle-ai`
- **Import**: `from calle import CalleClient`
- **Base URL**: `https://api.heycall-e.com` (default)
- **Auth**: `Authorization: Bearer <api_key>` header; key from https://dashboard.heycall-e.com/account/api-keys

## CalleClient

```python
client = CalleClient(
    api_key="calle_live_...",          # required
    base_url="https://api.heycall-e.com",  # default
    timeout=30.0,                      # HTTP timeout
)
```

Supports context manager: `with CalleClient(api_key=...) as client:`. Has `.calls`, `.goals`, `.webhooks` sub-clients, and a `.close()` method.

## Calls API

### `client.calls.create(...)`

```python
create(*, task, recipient=None, recipients=None, result_schema=None,
       recipient_result_schema=None, metadata=None, webhook_url=None,
       idempotency_key=None) -> dict
```

Creates a call task and **immediately starts execution** (planning + dialing). There is NO separate "plan-only" endpoint in the SDK — the two-step plan→run flow exists only in the MCP layer (`plan_call`/`run_call`/`get_call_run`) and the Goals API. The safety gate must happen BEFORE `create()`.

- `task` (str) — the natural-language goal for the voice agent
- `recipient` (dict) — `{"phone": "+14155551234"}` (internally normalized to `phones` array)
- `recipients` (list) — batch of recipients
- `result_schema` (dict) — JSON Schema for call-level `structured_result`
- `recipient_result_schema` (dict) — schema for per-recipient result in batch calls
- `metadata` (dict) — arbitrary key-values stored with the call
- `webhook_url` (str | None) — URL CALL-E POSTs the completed call result to (push notification instead of polling). CALL-E sends a `call.completed` event JSON to this URL. Requires a publicly-reachable endpoint (or a tunnel like cloudflared/ngrok for local dev).
- `idempotency_key` (str) — dedup key; re-sending the same key returns the same call

### Recommended pattern: explicit `create()` + `wait_for_result()` + `--no-wait` fallback

Do NOT use `create_and_wait()` — it loses the `call_id` on timeout, making the call unrecoverable. Use the explicit two-step pattern instead:

```python
call = client.calls.create(task=..., recipient=..., result_schema=..., idempotency_key=...)
call_id = str(call["id"])                     # survives even if polling fails
call = client.calls.wait_for_result(call_id,  # poll until terminal
    interval_seconds=5.0, timeout_seconds=900.0)
```

If the polling times out (unsupported region, voicemail, long hold), `call_id` is still available — resume with `get(call_id)` or a fresh `wait_for_result()`.

The CLI mirrors this with `--no-wait` and `--webhook-url`:

```bash
# Block until terminal (default)
$PY $BOOK book --confirm ...

# Create + exit immediately, poll later
$PY $BOOK book --confirm ... --no-wait
# → {"call_id": "call_...", "note": "Check: $BOOK status --call-id call_..."}

# Webhook push (implies --no-wait)
$PY $BOOK book --confirm ... --webhook-url "https://your-server.com/call-e-webhook"
# → {"call_id": "call_...", "note": "Webhook registered. Result will be POSTed to ..."}

# Resume checking an in-flight call
$PY $BOOK status --call-id call_... --events
```

### Environment auto-loading

`calle_booking.py` calls `_load_dotenv()` at startup, reading `~/.hermes/.env` into `os.environ` without clobbering already-set variables. This means `CALLE_API_KEY` and `BOOKING_PHONE` are available even in background processes (started via `terminal(background=true)`) that don't inherit the parent shell's exports.

### `client.calls.get(call_id) -> dict`

Returns the current call object. Key fields:

| Field | Type | Notes |
|---|---|---|
| `id` | str | call id (used for `status`) |
| `status` | str | `queued` \| `in_progress` \| `completed` \| `failed` \| `canceled` |
| `task_completed` | bool | CALL-E's completion judgment |
| `completion_confidence` | dict | `{score: float 0–1, label: low\|medium\|high}` |
| `structured_result` | dict \| null | schema-validated result, or null if it couldn't produce one |
| `evidence` | list | evidence/artifacts |
| `attempts` | list | one object per outbound dial attempt |

### CallTaskAttempt fields

| Field | Type | Notes |
|---|---|---|
| `id` | str | stable attempt id |
| `phone` | str | number dialed |
| `status` | str | `queued` \| `dialing` \| `in_progress` \| `completed` \| `failed` \| `canceled` |
| `started_at` | datetime \| null | ISO 8601, null before dialing |
| `completed_at` | datetime \| null | null until terminal |
| `summary` | str \| null | human-readable attempt summary |
| `transcript_turns` | list | structured per-speaker transcript turns |
| `failure_code` | str \| null | machine-readable failure reason |
| `failure_message` | str \| null | human-readable failure explanation |
| `provider_call_id` | str \| null | provider call id for support correlation |

### `client.calls.list_events(call_id, *, cursor=None, limit=None) -> dict`

Returns the event list (activity log + transcript events) for a call.

### `client.calls.wait_for_result(call_id, *, interval_seconds=2.0, timeout_seconds=600.0) -> dict`

Polls `get()` until `status` is in `{completed, failed, canceled}`. Raises `CalleTimeoutError` on timeout.

### `client.calls.create_and_wait(**kwargs) -> dict`

**Not recommended.** Convenience wrapper that calls `create(**kwargs)` then `wait_for_result(call_id)`. Pops `interval_seconds` and `timeout_seconds` from kwargs. The `call_id` is lost when the polling times out — use the explicit two-step pattern above instead.

## Goals API (pre-defined templates)

For reusable bookings, define a Goal on the CALL-E dashboard (with input variables + result schema), then run it against a phone number:

```python
client.goals.list(*, limit=20, after=None) -> dict
client.goals.get(goal_id) -> dict
client.goals.run(*, goal_id, phone, variables=None, idempotency_key) -> dict
client.goals.get_run(goal_id, goal_run_id) -> dict
client.goals.wait_for_result(goal_id, goal_run_id, *, interval_seconds=2.0, timeout_seconds=600.0) -> dict
client.goals.run_and_wait(*, goal_id, phone, variables=None, idempotency_key, ...) -> dict
```

Goal runs expose `result` (flat dict of scalars) or `error`. This is the SDK equivalent of the MCP `plan_call`/`run_call` split — the plan lives in the goal definition, and `run` starts it.

## Error types

| Exception | Meaning |
|---|---|
| `CalleAPIError` | 4xx/5xx response |
| `CalleAuthenticationError` | invalid/missing API key |
| `CalleConnectionError` | network failure before response |
| `CalleRateLimitError` | rate limited |
| `CalleTimeoutError` | timed out waiting |
| `CalleWebhookSignatureError` | webhook signature mismatch (not used in direct API) |

## Call lifecycle

```
call:    queued → in_progress → completed | failed | canceled
attempt: queued → dialing → in_progress → completed | failed | canceled
```

## Integration-path comparison (Hermes)

| Path | Notes |
|---|---|
| **Python SDK** (this skill's path) | `pip install calle-ai` + `CALLE_API_KEY`. No browser OAuth. Full control of result_schema + polling. |
| **Native MCP** | Streamable HTTP endpoint `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`, OAuth via browser, tools become `mcp_calle_*`. Two-step `plan_call`/`run_call`. |
| **skills.sh CLI** | `npm i -g @call-e/cli`, `calle auth login` (browser), `calle mcp tools`. Orchestrated via terminal. |
