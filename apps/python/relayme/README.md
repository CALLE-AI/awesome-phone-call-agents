# RelayMe (Python demo)

A runnable demo of the RelayMe skill: place one disclosed CALL-E call for a user
who cannot use the phone, and return a text-first, fail-closed result.

## Requirements

- Python 3 (standard library only; no third-party packages)
- For live calls only: the `calle` CLI installed and authenticated
  (`calle auth login`)

## Mock mode (default: no calls, no credentials)

From the repository root:

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock
```

This runs preflight, prints a masked call preview and the exact CALL-E goal,
replays a fixture transcript, and emits the structured result through the same
normalizer the live path uses. No number is dialled.

Point `--fixture` at another file to see other outcomes fail closed:

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --fixture apps/python/relayme/fixtures/answered.json
```

## Tests

```
python3 apps/python/relayme/test_dispatch.py
python3 apps/python/relayme/test_thread.py
python3 apps/python/relayme/test_client.py
python3 apps/python/relayme/test_calle_rest.py
```

No network. Covers fail-closed normalization, preflight validation, full ASCII
E.164 gating, preview-vs-live reservation namespacing, approved-origin pinning,
credential-redirect refusal, and the recipient/attempt result mapping.

## Live mode (places a real call)

RelayMe supports two live paths. Both place one real outbound call and consume a
CALL-E credit; use only with an authorized destination and explicit intent.

**OAuth / CLI path** (uses `calle auth login`):

```
python3 apps/python/relayme/client.py --task <authorized-task.json> --execute
```

Drives `calle call plan` -> `calle call run` -> `calle call status`, reading the
result from the CLI's `structuredContent` envelope.

**REST API path** — EXPERIMENTAL / UNFINISHED (uses a Bearer `api_key` from
`CALLE_API_KEY` or a local `.env`):

```
python3 apps/python/relayme/client.py --task <authorized-task.json> \
  --execute-rest --i-understand-rest-is-experimental
```

This path is not finished and is not the supported way to place a live call.
The live CALL-E API has rejected `result_schema` / `recipient_result_schema` on
`POST /v1/calls`, so provider-side structured results are not guaranteed to
return; use the OAuth / CLI path above for a supported live call. The client
refuses to run `--execute-rest` unless `--i-understand-rest-is-experimental` is
also passed. When it does run it drives `GET /v1/goals` preflight ->
`POST /v1/calls` (documented `recipients[]` schema with `region`/`locale`) ->
`GET /v1/calls/{id}` poll, then maps the `recipients[].attempts[].transcript_turns`
result through the same classifier and thread builder as every other path. It
never assumes the call disclosed it was AI: a result without an explicit
`disclosed_ai == true` fails closed to `needs_human`. Credentials are only ever
sent to an approved HTTPS origin, and redirects are refused so a 3xx cannot
forward the Bearer key off-origin. Provider error bodies and redirect
destinations are never surfaced; only a safe status summary is shown.

## Side effects and cancellation

- **Side effect:** `--execute` places one real outbound phone call and consumes
  one CALL-E call from the account.
- **No hidden retries:** one authorized task is one call. An uncertain outcome
  holds the reservation and is recovered manually with
  `calle call recover --recovery-id <id>`; the client never auto-redials or
  auto-recovers.
- **Cancellation:** if the user cancels before `--execute`, nothing is dialled.
  Mock mode never dials.
- **Idempotency key:** `relayme:{task_id}`.

## Safety

See `skills/relayme/references/safety.md`. AI disclosure is mandatory, the agent
never commits the user to anything, and results fail closed to `needs_human`.
