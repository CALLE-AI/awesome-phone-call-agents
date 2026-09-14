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
python3 apps/python/relayme/test_client.py
```

No network. Covers fail-closed normalization and preflight validation.

## Live mode (places a real call)

RelayMe supports two live paths. Both place one real outbound call and consume a
CALL-E credit; use only with an authorized destination and explicit intent.

**OAuth / CLI path** (uses `calle auth login`):

```
python3 apps/python/relayme/client.py --task <authorized-task.json> --execute
```

Drives `calle call plan` -> `calle call run` -> `calle call status`, reading the
result from the CLI's `structuredContent` envelope.

**REST API path** (uses a Bearer `api_key` from `CALLE_API_KEY` or a local `.env`):

```
python3 apps/python/relayme/client.py --task <authorized-task.json> --execute-rest
```

Drives `GET /v1/goals` preflight -> `POST /v1/calls` (documented `recipients[]`
schema with `region`/`locale`) -> `GET /v1/calls/{id}` poll, then maps the
`recipients[].attempts[].transcript_turns` result through the same classifier and
thread builder as every other path. The destination `region`/`locale` come from
the task's `region`/`language`; the recipient must be in a supported region.

## Side effects and cancellation

- **Side effect:** `--execute` places one real outbound phone call and consumes
  one CALL-E call from the account.
- **No hidden retries:** one authorized task is one call. An uncertain outcome is
  recovered with `calle call recover --recovery-id <id>`, not re-dialled.
- **Cancellation:** if the user cancels before `--execute`, nothing is dialled.
  Mock mode never dials.
- **Idempotency key:** `relayme:{task_id}`.

## Safety

See `skills/relayme/references/safety.md`. AI disclosure is mandatory, the agent
never commits the user to anything, and results fail closed to `needs_human`.
