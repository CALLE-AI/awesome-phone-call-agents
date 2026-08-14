# Durable CALL-E webhook result receiver

This reference app creates an explicitly authorized, one-off CALL-E follow-up
call and durably receives its terminal result. It is designed for at-least-once
webhook delivery: notification acceptance is stored in SQLite, a retried
canonical event is deduplicated, and a different payload with the same event ID
is rejected as a conflict.

It is not the SDK's basic in-memory parse-and-print webhook example. This app
keeps a small durable receipt record, checks the terminal-call workflow against
an authenticated Calls API response in server mode, and deliberately excludes
the raw call content from storage.

## Flow and boundaries

1. Start with a masked preview; it does not read credentials, access the
   network, or create a call.
2. To create a call, pass both explicit live flags for one authorized recipient
   and a public HTTPS webhook URL.
3. CALL-E sends an unsigned terminal notification to `/calle/webhook`.
4. The receiver validates its shape and event-ID consistency, then fetches the
   call from the authenticated Calls API before accepting it.
5. SQLite stores only a privacy-minimized receipt. Repeated equivalent delivery
   returns success without another API fetch; a same-ID different payload
   returns a conflict.

The current webhook notification is unsigned. The header and body event IDs
must match, but that equality is only a consistency check, not authentication.
Do not rely on deprecated legacy verification helpers for this workflow. The
authenticated `calls.get` re-fetch is the trust boundary in server mode.

## Requirements and setup

Use Python 3.11 or newer and [uv](https://docs.astral.sh/uv/). From this
directory:

```bash
uv sync --dev
```

`CALLE_API_KEY` is needed only to run the webhook server or to explicitly
create a live call. Keep it server-only, set it in the server environment, and
never put it in source control, fixtures, browser code, logs, or commands.

## Safe preview and fixture replay

The default create path is a masked preview. This command uses the reserved
fictional number `+12025550123`; it does not make a network request or create a
call:

```bash
uv run python create_call.py \
  --phone +12025550123 \
  --webhook-url https://receiver.example/calle/webhook \
  --workflow-id preview-follow-up
```

Fixture replay is also local-only. It uses the fixture payload as a synthetic
snapshot, marks the resulting row as `fixture`, and does not authenticate or
contact CALL-E. Run all three replays against a disposable database:

```bash
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-completed.json
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-failed.json
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-result-validation-failed.json
```

These commands do not access the network and cannot create a call. Delete
`.tmp/fixture-replays.sqlite3` after inspection if it is no longer useful.

## Run the receiver

The server listens on loopback by default. Its live server mode requires
`CALLE_API_KEY` because each accepted notification is reconciled through the
authenticated Calls API:

```bash
export CALLE_API_KEY="set-this-only-in-your-server-environment"
uv run python receiver.py --host 127.0.0.1 --port 8080 --database data/events.sqlite3
```

For CALL-E to deliver a webhook, put a reverse proxy or tunnel in front of the
loopback server. It must expose a public HTTPS URL whose path is
`/calle/webhook`, for example `https://your-public-host.example/calle/webhook`.
This app does not require a particular tunnel vendor or deployment platform.

Creating a real call is deliberately separate from serving. Use only for a
recipient who has authorized this specific call, and provide both flags:

```bash
uv run python create_call.py \
  --phone +12025550123 \
  --webhook-url https://your-public-host.example/calle/webhook \
  --workflow-id authorized-follow-up \
  --execute \
  --confirm-authorized-recipient
```

`--execute` and `--confirm-authorized-recipient` are both required. This is the
only command path that can create a billable CALL-E call; it creates at most
one call for the authorized recipient. The call task records only `yes`, `no`,
or `unknown` for a human follow-up. It does not make payments, arrange
shipping, modify profiles, or perform another business action.

## Webhook contract and delivery behavior

The endpoint accepts `POST /calle/webhook`. Requests require
`Content-Type: application/json`, exactly one valid decimal `Content-Length`,
no `Transfer-Encoding`, a body no larger than 1,048,576 bytes, and a
`CALL-E-Event-Id` header matching the body's `id`. Only these terminal event
types are supported:

| Condition | Result |
| --- | --- |
| First valid, reconciled terminal event | `200` and a durable receipt |
| Canonically identical retry | `200` with `duplicate: true`; no second receipt or API fetch |
| Wrong path | `404 not_found` |
| Unsupported method on the webhook path | `405 method_not_allowed` with `Allow: POST` |
| Missing/invalid JSON content type, invalid/duplicate `Content-Length`, or `Transfer-Encoding` | `400` |
| Body over 1,048,576 bytes | `413 payload_too_large` |
| Same event ID with a different payload | `409 event_id_conflict` |
| Malformed input, unsupported type, or header/body mismatch | `400` |
| Authenticated call does not match ID, terminal state, or workflow | `409` |
| Temporary CALL-E outage or rate limit | `503` so delivery can retry |
| Authentication, configured receiver/API, SQLite, or unexpected internal failure | Generic `500 internal_error` without exception details |

Supported types are `call.completed`, `call.failed`, and
`call.result_validation_failed`. Canonical event-ID deduplication makes the
handler safe for at-least-once delivery, not exactly-once delivery. A retry is
safe only after the original accepted receipt exists. An unsigned notification
alone is not trusted; the authenticated API result must agree on the call ID,
terminal status, and this app's workflow metadata before storage.

## Data and privacy

The SQLite `events` table stores exactly these nine columns:

1. `event_id`
2. `payload_digest`
3. `event_type`
4. `call_id`
5. `call_status`
6. `workflow_id`
7. `wants_human_callback`
8. `verification_mode`
9. `received_at`

It explicitly does not store the raw payload, task, phone number, summary,
evidence, transcript, free text, or any raw structured-result fields beyond
the allowed callback enum. Fixture replays store `verification_mode` as
`fixture`; they are synthetic tests, not authenticated results.

## Cleanup and operations

Press `Ctrl+C` to stop the local server. Deleting the SQLite database removes
the deduplication history, so wait until provider delivery retries are no
longer expected before deleting `data/events.sqlite3`. When testing or running
the app is complete, revoke or rotate `CALLE_API_KEY` according to your
credential policy.

## Tests and local verification

With `CALLE_API_KEY` unset, the following are offline checks and cannot place a
call:

```bash
unset CALLE_API_KEY
uv run pytest
uv run ruff check .
uv run python create_call.py --phone +12025550123 --webhook-url https://receiver.example/calle/webhook --workflow-id preview-follow-up
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-completed.json
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-failed.json
uv run python receiver.py --database .tmp/fixture-replays.sqlite3 --replay fixtures/call-result-validation-failed.json
```

From the repository root, also run:

```bash
python3 scripts/validate_repository.py
git diff --check
```

The test suite uses local fixtures and fake clients. It does not need live
credentials, does not call the network, and does not create a CALL-E call.
