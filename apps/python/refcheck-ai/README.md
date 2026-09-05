# RefCheck

Structured employment reference checks over CALL-E.

A recruiter lists a candidate's referees; RefCheck calls each one, works through
a role-specific question set with follow-up probes, and returns a schema-valid
result the hiring team can act on — per-question ratings, strengths, red flags,
quotes, and a weighted score.

The interesting part for this repository is that **no second LLM is involved**.
The question template compiles into a CALL-E `result_schema`, and CALL-E does
the extraction and validation server-side. There is no transcript-parsing pass
to prompt, pay for, retry, or defend against.

## What it demonstrates

| Pattern | Where |
| --- | --- |
| Template-driven `result_schema` — a sales template produces sales fields | `refcheck/schema.py` |
| Enum selection rules carried in `description`, enforcement in `enum`/`required` | `refcheck/schema.py` |
| An explicit `not_answered` rating, so a skipped question is missing evidence rather than a middling review | `refcheck/schema.py`, `refcheck/scoring.py` |
| Terminal webhook handling for an **unsigned** delivery, with at-least-once de-duplication and independent re-fetch | `refcheck/webhook.py` |
| Refusing to infer `no_answer` / `declined` from `failure_code` | `refcheck/results.py` |
| Stable idempotency keys, so a retried dispatch never places a second call | `refcheck/client.py` |
| Operator-authorized ASCII E.164 destinations, with non-ASCII confusables refused rather than transliterated | `refcheck/phone.py` |
| Bearer credentials pinned to the official HTTPS CALL-E origin | `refcheck/client.py` |
| Graceful handling of "we only confirm dates of employment" | `refcheck/task.py` |

## Setup

Python 3.11+.

```bash
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Dry run — the default path

Preview builds the exact task text and `result_schema` and prints them. It calls
nobody, and it works without an API key:

```bash
python cli.py --template engineering
```

Templates: `standard`, `engineering`, `sales`, `leadership`.

## Placing a real call

This dials a real phone and spends CALL-E credits, so it needs two independent
confirmations that come from different places.

```bash
export CALLE_API_KEY="iams_live_..."
export REFCHECK_ALLOWED_DESTINATIONS="+15555550142"

python cli.py --execute --i-have-consent \
    --to "+15555550142" \
    --referee "Jordan Referee" \
    --candidate "Alex Candidate" \
    --role "Senior Software Engineer" \
    --company "Northwind"
```

**`REFCHECK_ALLOWED_DESTINATIONS`** is the operator asserting they own or are
authorized to call each number. It is a comma-separated list of ASCII E.164
values. An unset or empty list authorizes *nothing*, so a misconfigured
deployment places no calls rather than every call. A number not on the list is
refused before the client is even constructed.

**`--i-have-consent`** is the separate claim that the referee agreed to be called
and the candidate authorized the reference check. Both are required; either one
missing exits non-zero and places no call.

### Destination validation

Numbers must be ASCII E.164 - a leading `+`, a country code starting 1-9, and
8-15 digits, with no spaces, hyphens or parentheses. Values containing non-ASCII
digits (Arabic-Indic, fullwidth, zero-width joiners) are **rejected rather than
transliterated**: a confusable digit is a different destination, and silently
"correcting" it would dial someone who was never authorized.

### Masking

Phone numbers are masked wherever this app prints them - preview and live alike,
including the task preview, error messages, structured results and transcripts.
`+15555550142` renders as `+1******0142`: enough to tell two destinations apart,
never enough to read one out of a terminal recording or a CI log.

## Receiving results by webhook

For anything beyond one call, take results asynchronously rather than blocking
on `wait_for_result`:

```bash
export CALLE_API_KEY="iams_live_..."
export REFCHECK_WEBHOOK_TOKEN="$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
uvicorn refcheck.webhook:app --port 8000

python cli.py --execute --i-have-consent --to "+15555550142" \
    --webhook-url "https://your-host/calle/webhook/$REFCHECK_WEBHOOK_TOKEN"
```

**CALL-E webhooks are not signed.** There is no webhook secret, `CALL-E-Timestamp`
or `CALL-E-Signature` header; the SDK's `webhooks.verify` and `webhooks.unwrap`
exist only for integrations running their own signing layer. So the receiver
treats every delivery as untrusted input:

1. it serves on an unguessable path token;
2. it requires `CALL-E-Event-Id` to match the body's `event.id`;
3. it re-fetches `GET /v1/calls/{call_id}` with the API key and stores **that**
   snapshot — the posted body is only a notification that something changed.

Delivery is at-least-once, so an event id is claimed in SQLite before any side
effect and duplicates are answered `200` without reprocessing. A verification
failure releases the claim and returns `5xx`, so CALL-E's retry is not swallowed.

## Side effects

- `--execute` places **one outbound phone call per reference** to a real number.
- Each call is billed against your CALL-E credits.
- The webhook receiver writes to a local SQLite file (`REFCHECK_DB`, default
  `refcheck.db`): the event ledger and one row per reference result.
- Nothing else leaves the machine. No email, no calendar, no CRM writes.
- Preview mode has no side effects at all.

## Cancellation

The Calls API **does not expose a client-side cancel**. Once a call task is
created it may run to completion whether or not you still want the result, and
the `canceled` resource status does not imply that clients can request
cancellation. Practical consequences:

- Treat `--execute` as the point of no return; preview first.
- For multi-reference checks, dispatch in waves and stop creating later waves
  once you have enough responses, rather than starting every call at once.
- To stop consuming results, stop the webhook receiver or rotate
  `REFCHECK_WEBHOOK_TOKEN`; calls already in flight will still complete.
- Re-running the same dispatch is safe: the idempotency key is derived from the
  reference id, so a retry does not place a second call.

## Credential handling

- `CALLE_API_KEY` is read from the environment only. It is never written to
  SQLite, never logged, and never printed — the CLI shows no key material.
- **The bearer token is pinned to the official HTTPS CALL-E origin.**
  `CALLE_BASE_URL` is parsed, not string-matched, and must resolve to exactly
  `https://api.heycall-e.com`. Plaintext HTTP, embedded userinfo, a path or
  query, and suffix look-alikes such as `https://api.heycall-e.com.evil.example`
  are all refused, so an operator who can set one environment variable cannot
  redirect the API key to a host they control.
- `REFCHECK_WEBHOOK_TOKEN` is the webhook path secret. Generate it randomly and
  treat it like a password; anyone holding it can post events at you (though
  they still cannot inject results, because of the re-fetch).
- Server-side use only. Neither value belongs in a browser or a mobile client.
- `REFCHECK_ALLOWED_DESTINATIONS` is the operator's dial authorization. Treat
  changes to it as a privileged action.
- Referee phone numbers are call inputs; they are not persisted by this app
  beyond the result row, and are masked in all output. Sample numbers throughout
  are in the reserved fictional `+1 555 01xx` range.

## Tests

109 tests, no credentials and no network:

```bash
pip install pytest
python -m pytest tests -q
```

They cover the schema staying inside CALL-E's supported JSON Schema subset for
every shipped template; the scoring weights; the webhook trust boundary (wrong
token, missing/mismatched event id, forged body, duplicate delivery,
verification failure and retry); E.164 validation including non-ASCII
confusables; the destination allowlist failing closed; masking never returning a
full number; and credential-target pinning against look-alike origins.

## Files

```text
refcheck-ai/
├── cli.py                  # preview by default; --execute --i-have-consent to dial
├── refcheck/
│   ├── phone.py            # E.164 validation, dial authorization, masking
│   ├── templates.py        # role-specific question sets
│   ├── schema.py           # template -> CALL-E result_schema
│   ├── task.py             # the call instruction
│   ├── client.py           # origin pinning, calls.create, idempotency key
│   ├── results.py          # reading a terminal call task
│   ├── scoring.py          # weighted score and recommendation
│   └── webhook.py          # unsigned-webhook receiver, SQLite ledger
├── examples/
│   └── fictional_structured_result.json
└── tests/
```

## License

MIT, matching this repository.
