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
5. SQLite stores only a privacy-minimized receipt. Repeated API-verified
   delivery returns success without another API fetch; a same-ID different
   payload returns a conflict. A matching fixture receipt never bypasses live
   reconciliation: live processing re-fetches and atomically upgrades it to
   `api` verification.

The current webhook notification is unsigned. The header and body event IDs
must match, but that equality is only a consistency check, not authentication.
Do not rely on deprecated legacy verification helpers for this workflow. The
authenticated `calls.get` re-fetch is the trust boundary in server mode.

### Production ownership

The CALL-E Calls API is authoritative for call-execution state. The integrating
application remains the source of truth for business intent and state,
persisted idempotency keys and call IDs, retry coordination, state transitions,
and audit history. A production application should commit its business intent
and stable idempotency key before submitting the call, then record the call ID
and creation outcome. This demo derives and sends a stable idempotency key, but
does not persist it.

An unverified webhook is a wake-up signal, not business authority. This demo's
SQLite `events` table is only a minimal receipt and deduplication store; it is
not a business-state store or a complete audit log. Once a matching receipt is
API-verified, a canonical duplicate can be acknowledged from durable
deduplication state without another API fetch.

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

Set `PUBLIC_WEBHOOK_URL` in your shell to a URL you control whose public HTTPS
path is `/calle/webhook`. Keeping the user-supplied value in a variable avoids
turning a documentation-only hostname into an executable example. The preview
does not resolve or connect to this URL.

The default create path is a masked preview. This command uses the reserved
fictional number `+12025550123`; it does not make a network request or create a
call:

```bash
: "${PUBLIC_WEBHOOK_URL:?Set this to your public HTTPS /calle/webhook URL}"
uv run python create_call.py \
  --phone +12025550123 \
  --webhook-url "$PUBLIC_WEBHOOK_URL" \
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
authenticated Calls API. For live receipts, use an access-controlled database
path outside the checkout and restrict its OS permissions:

```bash
export CALLE_API_KEY="set-this-only-in-your-server-environment"
: "${CALL_RECEIPT_DB:?Set this to a protected database path outside the checkout}"
uv run python receiver.py --host 127.0.0.1 --port 8080 --database "$CALL_RECEIPT_DB"
```

The local-demo default, `data/events.sqlite3`, is ignored by this app's
`.gitignore`, as are common SQLite files and journal/WAL/SHM sidecars. Ignoring
the path prevents an accidental commit; it does not encrypt or otherwise
protect the receipt data.

For CALL-E to deliver a webhook, put a reverse proxy or tunnel in front of the
loopback server. It must expose the user-supplied public HTTPS URL in
`PUBLIC_WEBHOOK_URL`, with path `/calle/webhook`. The proxy is required to
enforce connection-count and request-rate limits for the unsigned endpoint.
This app does not require a particular tunnel vendor or deployment platform.
The receiver itself admits at most eight active handlers and uses a two-second
body inactivity timeout plus a ten-second absolute body-read deadline.

During `--execute`, the creator validates DNS syntax, rejects special-use and
numeric-looking hostnames, resolves all A/AAAA answers, and requires every
answer to be globally routable. DNS failure rejects execution. These
offline-testable checks cannot prevent DNS rebinding after validation.
Provider-side connect-time egress checks or a destination allowlist remain
necessary.

Creating a real call is deliberately separate from serving. Use only for a
recipient who has authorized this specific call, and provide both flags:

```bash
uv run python create_call.py \
  --phone +12025550123 \
  --webhook-url "$PUBLIC_WEBHOOK_URL" \
  --workflow-id authorized-follow-up \
  --execute \
  --confirm-authorized-recipient
```

`--execute` and `--confirm-authorized-recipient` are both required. This is the
only command path that can create a billable CALL-E call; it creates at most
one call for the authorized recipient. The call task records only `yes`, `no`,
or `unknown` for a human follow-up. It does not make payments, arrange
shipping, modify profiles, or perform another business action.

A timeout, connection failure, response-decode failure, or malformed success
response after submission reports `call_creation_outcome_unknown`; the call may
already have been accepted. Retry only the identical intent so the stable
idempotency key is reused; changing the phone, workflow ID, task, or schema
creates a different intent. Successful output is limited to a bounded safe call
ID and one documented lifecycle status (`queued`, `in_progress`, `completed`,
`failed`, or `canceled`).

## Webhook contract and delivery behavior

The endpoint accepts `POST /calle/webhook`. Requests require exactly one
`Content-Type: application/json`, exactly one valid decimal `Content-Length`,
no `Transfer-Encoding`, a body no larger than 1,048,576 bytes, and exactly one
`CALL-E-Event-Id` header matching the body's `id`. JSON rejects duplicate
object keys and non-finite numbers such as `NaN` or `Infinity`. Event IDs and
call IDs must each be 1-128 ASCII URL-path-safe token characters
`[A-Za-z0-9_-]`; this is a local path-safety envelope, not a provider-prefix
claim. Only these terminal event types are supported:

| Condition | Result |
| --- | --- |
| First valid, reconciled terminal event | `200` and a durable receipt |
| Canonically identical API-verified retry | `200` with `duplicate: true`; no second receipt or API fetch |
| Wrong path | `404 not_found` |
| Unsupported method on the webhook path | `405 method_not_allowed` with `Allow: POST` |
| Missing/invalid JSON content type, invalid/duplicate `Content-Length`, or `Transfer-Encoding` | `400` |
| Body over 1,048,576 bytes | `413 payload_too_large` |
| Same event ID with a different payload | `409 event_id_conflict` |
| Malformed input, unsupported type, or header/body mismatch | `400` |
| Authenticated call does not match ID, terminal state, or workflow | `409` |
| Temporary CALL-E outage, SDK response decode failure, rate limit, or all eight handlers busy | Private `503` so delivery can retry |
| Authentication, configured receiver/API, SQLite, or unexpected internal failure | Generic `500 internal_error` without exception details |

Supported types are `call.completed`, `call.failed`, and
`call.result_validation_failed`. Canonical event-ID deduplication makes the
handler safe for at-least-once delivery, not exactly-once delivery. A retry is
safe only after the original accepted receipt exists. An unsigned notification
alone is not trusted; the authenticated API result must agree on the call ID,
terminal status, and this app's workflow metadata before storage.

An existing matching `api` receipt is a duplicate. An existing matching
`fixture` receipt is not trusted by live server mode: the receiver performs the
authenticated `calls.get`, validates the authoritative snapshot, and atomically
replaces the authoritative receipt fields while changing `verification_mode`
to `api`. Fixture replay never downgrades an `api` row. Live API requests use a
ten-second client timeout.

## Lifecycle and recovery

A production host can wrap this demo's receiver flow in the following durable
lifecycle:

1. Persist the business intent and stable idempotency key before call creation.
2. Create the call with that key and record the call ID and attempt outcome. If
   submission reports an unknown outcome, retry only the identical intent.
3. Receive the unsigned webhook, validate its envelope, and deduplicate by
   event ID and canonical payload digest.
4. Acknowledge a matching API-verified duplicate without another fetch.
   Otherwise, call `calls.get` to retrieve the authoritative terminal state.
5. On a transient Calls API failure, rate limit, timeout, or receiver-capacity
   failure, do not save a successful receipt and return `503` so delivery can
   retry.
6. Return `409` for an authoritative-state conflict. Storage, authentication,
   configuration, or unexpected internal failures return a private `500`.
7. In the synchronous path, commit the verified receipt before returning `200`.
   If a host also applies its business transition synchronously, commit that
   transition within the same durable boundary.

## Moving to production

This synchronous reference app is not a production-ready workflow architecture.
A production integration can replace in-request reconciliation with a durable
inbox or queue and a worker. The webhook handler must acknowledge delivery only
after the durable enqueue or inbox transaction commits.

The worker should call `calls.get`, retry transient failures with bounded
backoff, route permanent configuration or reconciliation failures for operator
review, and transactionally update application-owned business state and audit
history. The integrating application must define timeout budgets, maximum
attempts, transient-versus-permanent error classification, recovery scans,
event-ID retention, audit retention, and cleanup after the webhook retry
horizon. This guidance does not prescribe or add a queue, worker, or workflow
framework to this demo.

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
`fixture`; they are synthetic tests, not authenticated results. Treat the
database as sensitive operational state even though its contents are minimized.

## Cleanup and operations

Pressing `Ctrl+C` stops only the local receiver. Deleting the SQLite database
removes only deduplication history, and rotating `CALLE_API_KEY` changes only
future authentication. None of those actions cancels a call that CALL-E has
already accepted. This demo has no cancellation command; if CALL-E exposes a
dashboard or API cancellation mechanism, use it before the call reaches a
terminal state. Wait until delivery retries are no longer expected before
deleting the database.

This demo is not for emergency, medical, legal, financial, other regulated-
advice, or similarly high-risk workflows. Never treat a call result as
authority for an irreversible action.

## Tests and local verification

With `CALLE_API_KEY` unset, the following are offline checks and cannot place a
call:

```bash
unset CALLE_API_KEY
uv run pytest
uv run ruff check .
: "${PUBLIC_WEBHOOK_URL:?Set this to your public HTTPS /calle/webhook URL}"
uv run python create_call.py --phone +12025550123 --webhook-url "$PUBLIC_WEBHOOK_URL" --workflow-id preview-follow-up
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
